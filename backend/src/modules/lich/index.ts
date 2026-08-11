import { connect } from "node:net";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Module } from "../../core/types.js";
import type { EventBus } from "../../core/ws.js";
import { type LichStore, STALE_MS } from "./store.js";

/**
 * Lich module — the v1 Lich integration surface, ported to v2
 * (/api/publish, /api/status/:char, /api/watchdog, /api/commands,
 * /api/premium → /api/modules/lich/*). Consumers: gs4sd_publisher.lic,
 * gs4sd_premium.lic, gift_claim/gem_courier room lookups, the
 * gs4sd-watchdog timer script, and the invdb-parallel scanner's command
 * dispatch channel. Auth + scopes (lich.read / lich.write) on every route.
 */

export type GameProbe = () => Promise<boolean>;

const GAME_HOST = process.env.GAME_HOST || "storm.gs4.game.play.net";
const GAME_PORT = Number(process.env.GAME_PORT || 10024);
const PROBE_TIMEOUT_MS = 5000;
const CACHE_MS = 30_000;

/** TCP connect to the GS4 game server (mirrors v1 checkGameServer). */
function defaultGameProbe(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host: GAME_HOST, port: GAME_PORT, timeout: PROBE_TIMEOUT_MS });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.once("timeout", () => done(false));
  });
}

const publishBody = z.object({ character: z.string() }).catchall(z.unknown());
const commandBody = z.object({ target: z.string(), cmd: z.string() });
const premiumBody = z.object({ character: z.string() }).catchall(z.unknown());
const okSchema = z.object({ ok: z.boolean() });

const publishRoute = createRoute({
  method: "post",
  path: "/publish",
  request: { body: { content: { "application/json": { schema: publishBody } } } },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "published" },
    400: { description: "character required" },
  },
});

const statusRoute = createRoute({
  method: "get",
  path: "/status/:char",
  request: { params: z.object({ char: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: z.record(z.unknown()) } }, description: "latest published state" },
    404: { description: "no state for character" },
  },
});

const watchdogRoute = createRoute({
  method: "get",
  path: "/watchdog",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            gameUp: z.boolean(),
            checkedAt: z.string(),
            characters: z.array(
              z.object({
                name: z.string(),
                online: z.boolean(),
                lastSeen: z.number().nullable(),
                ageSec: z.number().nullable(),
              }),
            ),
          }),
        },
      },
      description: "game + per-char liveness for the watchdog timer script",
    },
  },
});

const commandPostRoute = createRoute({
  method: "post",
  path: "/commands",
  request: { body: { content: { "application/json": { schema: commandBody } } } },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean(), target: z.string(), cmd: z.string(), cmdType: z.string() }),
        },
      },
      description: "queued",
    },
    400: { description: "target and cmd required" },
  },
});

const commandGetRoute = createRoute({
  method: "get",
  path: "/commands/:char",
  request: { params: z.object({ char: z.string() }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.union([
            z.object({ from: z.string(), cmd: z.string(), cmdType: z.string(), ts: z.number() }),
            z.object({ cmd: z.null() }),
          ]),
        },
      },
      description: "next pending command for the char (consumed on read)",
    },
  },
});

const premiumPostRoute = createRoute({
  method: "post",
  path: "/premium",
  request: { body: { content: { "application/json": { schema: premiumBody } } } },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "saved" },
    400: { description: "character required" },
  },
});

export function createLichModule(store: LichStore, opts: { gameProbe?: GameProbe } = {}): Module {
  const gameProbe = opts.gameProbe ?? defaultGameProbe;
  let cache: { up: boolean; at: number } | null = null;

  async function probeCached(): Promise<boolean> {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_MS) return cache.up;
    const up = await gameProbe();
    cache = { up, at: now };
    return up;
  }

  return {
    name: "lich",
    prefix: "/api/modules/lich",
    scopes: [
      { name: "lich.read", description: "Read publisher state, status, watchdog, pending commands" },
      { name: "lich.write", description: "Publish state, queue commands, record premium info" },
    ],
    routeScopes: {
      "GET /status/:char": ["lich.read"],
      "GET /watchdog": ["lich.read"],
      "GET /commands/:char": ["lich.read"],
      "POST /publish": ["lich.write"],
      "POST /commands": ["lich.write"],
      "POST /premium": ["lich.write"],
    },
    registerRoutes(router: OpenAPIHono, deps: unknown): void {
      const { eventBus } = deps as { eventBus: EventBus };

      router.openapi(publishRoute, async (c) => {
        const body = c.req.valid("json");
        const character = (body.character || "").trim();
        if (!character) return c.json({ error: "character required" }, 400);
        const state = await store.publish(character, body as Record<string, unknown>);
        eventBus.emit("lich_state", { character: state.character, data: state });
        return c.json({ ok: true }, 200);
      });

      router.openapi(statusRoute, async (c) => {
        const state = await store.status(c.req.valid("param").char);
        if (!state) return c.json({ error: "no state for character" }, 404);
        return c.json(state, 200);
      });

      router.openapi(watchdogRoute, async (c) => {
        const gameUp = await probeCached();
        const now = Date.now();
        const characters = [];
        for (const name of await store.managed()) {
          const state = await store.status(name);
          const lastSeen = state ? state.ts : 0;
          const age = lastSeen ? now - lastSeen : -1;
          characters.push({
            name,
            online: age >= 0 && age < STALE_MS,
            lastSeen: lastSeen || null,
            ageSec: age >= 0 ? Math.round(age / 1000) : null,
          });
        }
        return c.json({ gameUp, checkedAt: new Date(now).toISOString(), characters }, 200);
      });

      router.openapi(commandPostRoute, async (c) => {
        const body = c.req.valid("json");
        if (!body.target || !body.cmd) return c.json({ error: "target and cmd required" }, 400);
        const user = (c.get("user" as never) as { name?: string } | undefined)?.name ?? "unknown";
        const msg = await store.pushCommand(body.target, user, body.cmd);
        eventBus.emit("lich_command", { target: body.target.toLowerCase(), data: msg });
        return c.json({ ok: true, target: body.target, cmd: body.cmd, cmdType: msg.cmdType }, 200);
      });

      router.openapi(commandGetRoute, async (c) => {
        const msg = await store.popCommand(c.req.valid("param").char);
        if (!msg) return c.json({ cmd: null }, 200);
        return c.json(msg, 200);
      });

      router.openapi(premiumPostRoute, async (c) => {
        const body = c.req.valid("json");
        const character = (body.character || "").trim();
        if (!character) return c.json({ error: "character required" }, 400);
        await store.savePremium(character, body as Record<string, unknown>);
        eventBus.emit("lich_premium", { character: character.toLowerCase() });
        return c.json({ ok: true }, 200);
      });
    },
  };
}
