import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { CoreDb } from "../../core/db.js";
import { EventLog } from "../../core/event-log.js";
import type { Totp } from "../../core/totp.js";
import type { Module } from "../../core/types.js";
import type { AccountsStore } from "./store.js";

const accountSchema = z.object({
  account_name: z.string(),
  auth_status: z.string(),
  auth_error: z.string().nullable(),
  store_balance: z.number().nullable(),
  store_reward_next: z.string().nullable(),
  last_scan: z.number(),
});

const characterSchema = z.object({
  account_name: z.string(),
  char_name: z.string(),
  slot: z.string().nullable(),
  game_code: z.string(),
  source: z.string(),
  level: z.number().nullable().optional(),
  race: z.string().nullable().optional(),
  profession: z.string().nullable().optional(),
  last_login: z.string().nullable().optional(),
  status: z.string(),
  auto_added: z.number(),
});

const okSchema = z.object({ ok: z.boolean() });

const accountsRoute = createRoute({
  method: "get",
  path: "/accounts",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ accounts: z.array(accountSchema), characters: z.array(characterSchema) }),
        },
      },
      description: "scan results",
    },
  },
});

const staleRoute = createRoute({
  method: "get",
  path: "/accounts/stale",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ characters: z.array(characterSchema), accounts: z.array(accountSchema) }),
        },
      },
      description: "stale characters + problem accounts",
    },
  },
});

const scanStatusRoute = createRoute({
  method: "get",
  path: "/accounts/scan/status",
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ running: z.boolean() }) } },
      description: "scan status",
    },
  },
});

const scanAllRoute = createRoute({
  method: "post",
  path: "/accounts/scan",
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ ok: z.boolean(), total: z.number(), message: z.string() }) },
      },
      description: "scan started",
    },
    409: { description: "scan already running" },
  },
});

const scanOneRoute = createRoute({
  method: "post",
  path: "/accounts/:name/scan",
  request: { params: z.object({ name: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "scan complete" },
    404: { description: "account not found" },
  },
});

const totpStatusRoute = createRoute({
  method: "get",
  path: "/totp/status",
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ setup: z.boolean() }) } },
      description: "totp setup state",
    },
  },
});

const totpSetupRoute = createRoute({
  method: "post",
  path: "/totp/setup",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ secret: z.string(), uri: z.string(), qrDataUrl: z.string() }),
        },
      },
      description: "enrollment data",
    },
    400: { description: "already setup" },
  },
});

const totpVerifyRoute = createRoute({
  method: "post",
  path: "/totp/verify",
  request: { body: { content: { "application/json": { schema: z.object({ code: z.string() }) } } } },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ valid: z.boolean() }) } },
      description: "verification result",
    },
  },
});

const totpResetRoute = createRoute({
  method: "post",
  path: "/totp/reset",
  request: { body: { content: { "application/json": { schema: z.object({ code: z.string() }) } } } },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "reset" },
    403: { description: "invalid code" },
  },
});

const entryAccountBody = z.object({ account_name: z.string(), password: z.string(), totp_code: z.string() });
const entryPasswordBody = z.object({ password: z.string(), totp_code: z.string() });
const entryCharBody = z.object({ char_name: z.string(), game_code: z.string().optional(), totp_code: z.string() });
const totpOnlyBody = z.object({ totp_code: z.string() });

const stepsSchema = z.object({ steps: z.array(z.object({ action: z.string(), result: z.string() })) });

const entryAddAccountRoute = createRoute({
  method: "post",
  path: "/entry/account",
  request: { body: { content: { "application/json": { schema: entryAccountBody } } } },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "account added" },
    400: { description: "account_name and password required" },
    403: { description: "TOTP required/invalid" },
    409: { description: "account already exists" },
  },
});

const entryDeleteAccountRoute = createRoute({
  method: "delete",
  path: "/entry/account/:name",
  request: {
    params: z.object({ name: z.string() }),
    body: { content: { "application/json": { schema: totpOnlyBody } } },
  },
  responses: {
    200: { content: { "application/json": { schema: okSchema.merge(stepsSchema) } }, description: "account deleted" },
    403: { description: "TOTP required/invalid" },
  },
});

const entryUpdatePasswordRoute = createRoute({
  method: "patch",
  path: "/entry/account/:name/password",
  request: {
    params: z.object({ name: z.string() }),
    body: { content: { "application/json": { schema: entryPasswordBody } } },
  },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "password updated" },
    400: { description: "password required" },
    403: { description: "TOTP required/invalid" },
    404: { description: "account not found" },
  },
});

const entryAddCharacterRoute = createRoute({
  method: "post",
  path: "/entry/account/:name/character",
  request: {
    params: z.object({ name: z.string() }),
    body: { content: { "application/json": { schema: entryCharBody } } },
  },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "character added" },
    400: { description: "char_name required" },
    403: { description: "TOTP required/invalid" },
    404: { description: "account not found" },
    409: { description: "character already exists" },
  },
});

const entryDeleteCharacterRoute = createRoute({
  method: "delete",
  path: "/entry/account/:name/character/:char",
  request: {
    params: z.object({ name: z.string(), char: z.string() }),
    body: { content: { "application/json": { schema: totpOnlyBody } } },
  },
  responses: {
    200: { content: { "application/json": { schema: okSchema.merge(stepsSchema) } }, description: "character deleted" },
    403: { description: "TOTP required/invalid" },
    404: { description: "character not found anywhere" },
  },
});

const cleanupStaleRoute = createRoute({
  method: "post",
  path: "/accounts/stale/cleanup",
  request: { body: { content: { "application/json": { schema: totpOnlyBody } } } },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            ok: z.boolean(),
            removedAccounts: z.number(),
            removedCharacters: z.number(),
            steps: z.array(z.object({ action: z.string(), result: z.string() })),
          }),
        },
      },
      description: "stale cleanup complete",
    },
    403: { description: "TOTP required/invalid" },
  },
});

/** v1 TOTP gate: 2FA must be configured and the code valid. */
function requireTotp(totp: Totp, code?: string): string | null {
  if (!totp.isSetup()) return "2FA not configured — set up TOTP first";
  if (!code) return "totp_code required";
  if (!totp.verify(code)) return "invalid TOTP code";
  return null;
}

export function createAccountsModule(store: AccountsStore, totp: Totp): Module {
  return {
    name: "accounts",
    prefix: "/api/modules/accounts",
    scopes: [
      { name: "accounts.read", description: "Read accounts, scan results, TOTP status" },
      { name: "accounts.write", description: "Scan accounts, manage entry.yaml (TOTP-gated), TOTP setup" },
    ],
    nav: { path: "/accounts", title: "Accounts", group: "people", order: 20, icon: "👥" },
    routeScopes: {
      "GET /accounts": ["accounts.read"],
      "GET /accounts/scan/status": ["accounts.read"],
      "GET /accounts/stale": ["accounts.read"],
      "POST /accounts/stale/cleanup": ["accounts.write"],
      "POST /accounts/scan": ["accounts.write"],
      "POST /accounts/:name/scan": ["accounts.write"],
      "GET /totp/status": ["accounts.read"],
      "POST /totp/setup": ["accounts.write"],
      "POST /totp/verify": ["accounts.read"],
      "POST /totp/reset": ["accounts.write"],
      "POST /entry/account": ["accounts.write"],
      "DELETE /entry/account/:name": ["accounts.write"],
      "PATCH /entry/account/:name/password": ["accounts.write"],
      "POST /entry/account/:name/character": ["accounts.write"],
      "DELETE /entry/account/:name/character/:char": ["accounts.write"],
    },
    registerRoutes(router: OpenAPIHono, _deps: unknown): void {
      // spec building calls registerRoutes with empty deps — logging is optional there
      const db = (_deps as { db?: CoreDb }).db;
      const eventLog = db ? new EventLog(db) : null;
      router.openapi(accountsRoute, async (c) => c.json(await store.list()));
      router.openapi(staleRoute, async (c) => c.json(await store.stale()));
      router.openapi(scanStatusRoute, async (c) => c.json({ running: store.scanRunning() }));
      router.openapi(scanAllRoute, async (c) => {
        const res = await store.scanAll();
        if (!res.ok) return c.json({ error: res.error }, 409);
        return c.json({ ok: true, total: res.total ?? 0, message: res.message ?? "" }, 200);
      });
      router.openapi(scanOneRoute, async (c) => {
        const res = await store.scanOne(c.req.valid("param").name);
        if (!res.ok) return c.json({ error: res.error }, 404);
        return c.json({ ok: true }, 200);
      });

      router.openapi(totpStatusRoute, async (c) => c.json({ setup: totp.isSetup() }));
      router.openapi(totpSetupRoute, async (c) => {
        if (totp.isSetup()) return c.json({ error: "already setup — reset first" }, 400);
        const { secret, uri, qrDataUrl } = totp.setup();
        eventLog?.log("totp_setup", null, "TOTP enrollment created", "api");
        return c.json({ secret, uri, qrDataUrl: await qrDataUrl }, 200);
      });
      router.openapi(totpVerifyRoute, async (c) => c.json({ valid: totp.verify(c.req.valid("json").code) }));
      router.openapi(totpResetRoute, async (c) => {
        if (!totp.verify(c.req.valid("json").code)) return c.json({ error: "invalid TOTP code" }, 403);
        totp.reset();
        eventLog?.log("totp_reset", null, "TOTP reset", "api");
        return c.json({ ok: true }, 200);
      });

      router.openapi(entryAddAccountRoute, async (c) => {
        const body = c.req.valid("json");
        const err = requireTotp(totp, body.totp_code);
        if (err) return c.json({ error: err }, 403);
        if (!body.account_name || !body.password) return c.json({ error: "account_name and password required" }, 400);
        const res = await store.addAccount(body.account_name, body.password);
        if (!res.ok) return c.json({ error: res.error }, res.code === "exists" ? 409 : 500);
        return c.json({ ok: true }, 200);
      });

      router.openapi(entryDeleteAccountRoute, async (c) => {
        const { totp_code } = c.req.valid("json");
        const err = requireTotp(totp, totp_code);
        if (err) return c.json({ error: err }, 403);
        const { steps } = await store.deleteAccountWithSteps(c.req.valid("param").name);
        return c.json({ ok: true, steps }, 200);
      });

      router.openapi(entryUpdatePasswordRoute, async (c) => {
        const body = c.req.valid("json");
        const err = requireTotp(totp, body.totp_code);
        if (err) return c.json({ error: err }, 403);
        if (!body.password) return c.json({ error: "password required" }, 400);
        const res = await store.updateAccountPassword(c.req.valid("param").name, body.password);
        if (!res.ok) return c.json({ error: res.error }, res.code === "encrypt" ? 500 : 404);
        return c.json({ ok: true }, 200);
      });

      router.openapi(entryAddCharacterRoute, async (c) => {
        const body = c.req.valid("json");
        const err = requireTotp(totp, body.totp_code);
        if (err) return c.json({ error: err }, 403);
        if (!body.char_name) return c.json({ error: "char_name required" }, 400);
        const res = await store.addEntryCharacter(c.req.valid("param").name, body.char_name, body.game_code ?? "GS3");
        if (!res.ok) return c.json({ error: res.error }, res.error?.includes("not found") ? 404 : 409);
        return c.json({ ok: true }, 200);
      });

      router.openapi(entryDeleteCharacterRoute, async (c) => {
        const { totp_code } = c.req.valid("json");
        const err = requireTotp(totp, totp_code);
        if (err) return c.json({ error: err }, 403);
        const { steps } = await store.deleteCharacterWithSteps(c.req.valid("param").name, c.req.valid("param").char);
        if (!steps.some((s) => s.result === "ok")) return c.json({ error: "character not found anywhere", steps }, 404);
        return c.json({ ok: true, steps }, 200);
      });

      router.openapi(cleanupStaleRoute, async (c) => {
        const { totp_code } = c.req.valid("json");
        const err = requireTotp(totp, totp_code);
        if (err) return c.json({ error: err }, 403);
        const res = await store.cleanupStale();
        return c.json(res, 200);
      });
    },
  };
}
