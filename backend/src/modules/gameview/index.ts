import { connect } from "node:net";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { Systemd, SystemdError, validateCharName } from "../../core/systemd.js";
import type { Module } from "../../core/types.js";

/**
 * Game View seam (docs/design/output/04-game-view): the dashboard links OUT to
 * a per-character VellumFE stream in a new tab — we never embed or proxy it.
 * Stream URLs are built from deploy config (never hardcoded in frontend):
 *   VELLUM_BASE_URL = https://vellum.phylactery.ovh
 *   VELLUM_STREAMS  = "Fisternar:9101:9201,Neleourg:9102:9202"  (char:detach:web)
 * The URL prefills the web UI's Lich-attach form (the UI deliberately never
 * auto-connects from URL params); pairing is remembered per browser.
 *
 * POST /launch/:char (item-search step 5b): one-click bring-online for a char
 * that has a configured stream. When the char's Lich unit is inactive it is
 * started through the review-gated Systemd capability, then the stream URL is
 * returned so the frontend can open it (zero-click auto-connect). Chars
 * without a VELLUM_STREAMS entry cannot launch — provisioning a stream for a
 * new char is the separate "stream more chars" recipe (§VellumFE).
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

interface StreamOpts {
  baseUrl?: string;
  /** Zone for per-char stream hosts (one level, e.g. phylactery.ovh — Cloudflare
   *  Universal SSL only covers one wildcard level, so char hosts live at
   *  <char>.<streamDomain>, NOT <char>.<sub>.streamDomain). */
  streamDomain?: string;
  /** VellumFE pairing token (shared data dir). Auto-pairs the web UI on load. */
  token?: string;
}

/** Build the stream URL (same shape as the GET /streams route). */
export function buildStreamUrl(char: string, entry: { detach: number }, opts: StreamOpts): string {
  const base = (opts.baseUrl ?? "").replace(/\/$/, "");
  const frag = opts.token ? `token=${opts.token}&` : "";
  // One-level char host (<char>.<streamDomain>): the browser sends the Host
  // header (unlike the URL fragment), so Caddy routes each char to its own
  // vellum instance; the fragment only prefills the attach form.
  const host = opts.streamDomain ? `${char.toLowerCase()}.${opts.streamDomain}` : base.slice(base.indexOf("://") + 3);
  return `https://${host}/play#${frag}lich=127.0.0.1:${entry.detach}&name=${char}`;
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

const launchRoute = createRoute({
  method: "post",
  path: "/launch/:char",
  request: { params: z.object({ char: z.string() }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            char: z.string(),
            url: z.string(),
            started: z.boolean(),
          }),
        },
      },
      description: "stream URL; the char's Lich unit was started when it was inactive",
    },
    400: { description: "invalid character name" },
    404: { description: "character has no configured stream" },
    500: { description: "failed to start the Lich unit" },
  },
});

export function createGameviewModule(opts: {
  baseUrl?: string;
  streamDomain?: string;
  streams?: string;
  token?: string;
  probe?: StreamProbe;
  /** Review-gated Systemd capability (defaults to the real one; inject in tests). */
  systemd?: Systemd;
}): Module {
  const systemd = opts.systemd ?? new Systemd();
  return {
    name: "gameview",
    prefix: "/api/modules/gameview",
    scopes: [{ name: "gameview.read", description: "Read character stream links" }],
    routeScopes: {
      "GET /streams": ["gameview.read"],
      // Launch = bring a configured stream online: either write scope suffices.
      "POST /launch/:char": ["lich.write", "characters.write"],
    },
    registerRoutes(router: OpenAPIHono, _deps: unknown): void {
      router.openapi(streamsRoute, async (c) => {
        const probe = opts.probe ?? tcpProbe;
        const streams = parseStreams(opts.streams);
        const out: Record<string, { url: string; up: boolean }> = {};
        for (const [char, entry] of Object.entries(streams)) {
          out[char] = { url: buildStreamUrl(char, entry, opts), up: await probe(entry.web) };
        }
        return c.json(out);
      });

      router.openapi(launchRoute, async (c) => {
        const char = c.req.valid("param").char;
        try {
          validateCharName(char);
        } catch (err) {
          const msg = err instanceof SystemdError ? err.message : "invalid character name";
          return c.json({ error: msg }, 400);
        }
        const entry = parseStreams(opts.streams)[char];
        if (!entry) return c.json({ error: `no stream configured for ${char}` }, 404);
        const status = await systemd.show(char);
        let started = false;
        if (!status.active) {
          const res = await systemd.action("start", char);
          if (!res.ok) return c.json({ error: res.error ?? "failed to start session" }, 500);
          started = true;
        }
        return c.json({ char, url: buildStreamUrl(char, entry, opts), started }, 200);
      });
    },
  };
}
