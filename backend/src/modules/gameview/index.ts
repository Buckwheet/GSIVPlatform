import { connect } from "node:net";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Module } from "../../core/types.js";

/**
 * Game View seam (docs/design/output/04-game-view): the dashboard links OUT to
 * a per-character VellumFE stream in a new tab — we never embed or proxy it.
 * Stream URLs are built from deploy config (never hardcoded in frontend):
 *   VELLUM_BASE_URL = https://vellum.phylactery.ovh
 *   VELLUM_STREAMS  = "Fisternar:9101:9201,Neleourg:9102:9202"  (char:detach:web)
 * The URL prefills the web UI's Lich-attach form (the UI deliberately never
 * auto-connects from URL params); pairing is remembered per browser.
 */

export type StreamProbe = (webPort: number) => Promise<boolean>;

const PROBE_TIMEOUT_MS = 800;

function tcpProbe(webPort: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host: "127.0.0.1", port: webPort });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(PROBE_TIMEOUT_MS, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

/** Parse "Char:detach:web,Char:detach:web" → map; invalid entries are skipped. */
export function parseStreams(raw?: string): Record<string, { detach: number; web: number }> {
  const out: Record<string, { detach: number; web: number }> = {};
  for (const part of (raw ?? "").split(",").map((s) => s.trim())) {
    if (!part) continue;
    const [char, detach, web] = part.split(":");
    const d = Number(detach);
    const w = Number(web);
    if (!char || !Number.isInteger(d) || !Number.isInteger(w)) continue;
    out[char] = { detach: d, web: w };
  }
  return out;
}

const streamsRoute = createRoute({
  method: "get",
  path: "/streams",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.record(
            z.object({
              url: z.string(),
              up: z.boolean(),
            }),
          ),
        },
      },
      description: "per-character stream URLs",
    },
  },
});

export function createGameviewModule(opts: {
  baseUrl?: string;
  /** Zone for per-char stream hosts (one level, e.g. phylactery.ovh — Cloudflare
   *  Universal SSL only covers one wildcard level, so char hosts live at
   *  <char>.<streamDomain>, NOT <char>.<sub>.streamDomain). */
  streamDomain?: string;
  streams?: string;
  /** VellumFE pairing token (shared data dir). Auto-pairs the web UI on load. */
  token?: string;
  probe?: StreamProbe;
}): Module {
  return {
    name: "gameview",
    prefix: "/api/modules/gameview",
    scopes: [{ name: "gameview.read", description: "Read character stream links" }],
    routeScopes: { "GET /streams": ["gameview.read"] },
    registerRoutes(router: OpenAPIHono, _deps: unknown): void {
      router.openapi(streamsRoute, async (c) => {
        const base = (opts.baseUrl ?? "").replace(/\/$/, "");
        const probe = opts.probe ?? tcpProbe;
        const streams = parseStreams(opts.streams);
        const out: Record<string, { url: string; up: boolean }> = {};
        for (const [char, { detach, web }] of Object.entries(streams)) {
          const frag = opts.token ? `token=${opts.token}&` : "";
          // One-level char host (<char>.<streamDomain>): the browser sends the
          // Host header (unlike the URL fragment), so Caddy routes each char to
          // its own vellum instance; the fragment only prefills the attach form.
          const host = opts.streamDomain
            ? `${char.toLowerCase()}.${opts.streamDomain}`
            : base.slice(base.indexOf("://") + 3);
          const url = `https://${host}/play#${frag}lich=127.0.0.1:${detach}&name=${char}`;
          out[char] = { url, up: await probe(web) };
        }
        return c.json(out);
      });
    },
  };
}
