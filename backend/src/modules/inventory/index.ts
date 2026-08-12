import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Module } from "../../core/types.js";
import type { InventoryStore } from "./store.js";

const charSchema = z.object({
  id: z.number(),
  name: z.string(),
  game: z.string(),
  account: z.string(),
  prof: z.string(),
  race: z.string(),
  level: z.number(),
  exp: z.number(),
  area: z.string(),
  subscription: z.string(),
  citizenship: z.string(),
  society: z.string(),
  society_rank: z.string(),
  timestamp: z.number(),
});

const searchRowSchema = z.object({
  character: z.string(),
  prof: z.string(),
  level: z.number(),
  location: z.string(),
  item: z.string(),
  noun: z.string(),
  type: z.string(),
  amount: z.number(),
  stack: z.string(),
  status: z.string(),
  marked: z.string(),
  worn: z.string(),
});

const resourceRowSchema = z.object({
  character: z.string(),
  prof: z.string(),
  level: z.number(),
  energy: z.string(),
  weekly: z.number(),
  total: z.number(),
  suffused: z.number(),
  favor: z.number(),
  bonus: z.number(),
});

const ticketRowSchema = z.object({
  character: z.string(),
  prof: z.string(),
  level: z.number(),
  source: z.string(),
  amount: z.number(),
  currency: z.string(),
});

const routes = {
  summary: createRoute({
    method: "get",
    path: "/summary",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ characters: z.number(), items: z.number(), totalSilver: z.number() }),
          },
        },
        description: "Inventory summary counts",
      },
    },
  }),
  characters: createRoute({
    method: "get",
    path: "/characters",
    responses: { 200: { content: { "application/json": { schema: z.array(charSchema) } }, description: "Characters" } },
  }),
  locations: createRoute({
    method: "get",
    path: "/locations",
    responses: {
      200: {
        content: { "application/json": { schema: z.array(z.object({ name: z.string() })) } },
        description: "Locations",
      },
    },
  }),
  bank: createRoute({
    method: "get",
    path: "/bank",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.array(
              z.object({
                character: z.string(),
                account: z.string(),
                prof: z.string(),
                level: z.number(),
                bank: z.string(),
                silvers: z.number(),
              }),
            ),
          },
        },
        description: "Bank silvers",
      },
    },
  }),
  search: createRoute({
    method: "get",
    path: "/search",
    request: {
      query: z.object({
        q: z.string().optional(),
        character: z.string().optional(),
        location: z.string().optional(),
      }),
    },
    responses: {
      200: { content: { "application/json": { schema: z.array(searchRowSchema) } }, description: "Search results" },
    },
  }),
  resources: createRoute({
    method: "get",
    path: "/resources",
    responses: {
      200: { content: { "application/json": { schema: z.array(resourceRowSchema) } }, description: "Resources" },
    },
  }),
  tickets: createRoute({
    method: "get",
    path: "/tickets",
    responses: {
      200: { content: { "application/json": { schema: z.array(ticketRowSchema) } }, description: "Tickets" },
    },
  }),
  time: createRoute({
    method: "get",
    path: "/time",
    responses: {
      200: {
        content: { "application/json": { schema: z.object({ now: z.string(), tz: z.string() }) } },
        description: "Server time",
      },
    },
  }),
  schedule: createRoute({
    method: "get",
    path: "/schedule",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              enabled: z.boolean(),
              time: z.string().nullable(),
              next_run: z.string().nullable(),
              error: z.string().nullable(),
            }),
          },
        },
        description: "Scan schedule state",
      },
    },
  }),
  setSchedule: createRoute({
    method: "put",
    path: "/schedule",
    request: {
      body: {
        content: { "application/json": { schema: z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }) } },
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              enabled: z.boolean(),
              time: z.string().nullable(),
              next_run: z.string().nullable(),
              error: z.string().nullable(),
            }),
          },
        },
        description: "Updated schedule state",
      },
      400: { description: "time must be HH:MM (server/UTC)" },
      500: {
        content: {
          "application/json": {
            schema: z.object({
              enabled: z.boolean(),
              time: z.string().nullable(),
              next_run: z.string().nullable(),
              error: z.string().nullable(),
            }),
          },
        },
        description: "Failed to apply schedule",
      },
    },
  }),
  scanStart: createRoute({
    method: "post",
    path: "/scan/start",
    responses: {
      200: {
        content: { "application/json": { schema: z.object({ ok: z.boolean(), started: z.boolean() }) } },
        description: "Scan triggered",
      },
      500: {
        content: { "application/json": { schema: z.object({ ok: z.boolean(), started: z.boolean() }) } },
        description: "Failed to start scan",
      },
    },
  }),
  scanStatus: createRoute({
    method: "get",
    path: "/scan/status",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              running: z.boolean(),
              last_log: z.string().nullable(),
              chars: z.number(),
              items: z.number(),
              data_as_of: z.string().nullable(),
            }),
          },
        },
        description: "Scan status + inventory counts",
      },
    },
  }),
};

type RunFn = (cmd: string) => string;

const TIMER_UNIT = "gsiv-invdb-scan";
const TIMER_FILE = `/etc/systemd/system/${TIMER_UNIT}.timer`;
const SERVICE_FILE = `/etc/systemd/system/${TIMER_UNIT}.service`;
const SCAN_SCRIPT = "/opt/gs4sd/scripts/invdb-scan-all.sh";
const SCAN_LOGS_DIR = "/opt/gs4sd/data/invdb-logs";
const SERVICE_BODY = `[Unit]
Description=GSIV invdb scan-all (oneshot)
After=network-online.target

[Service]
Type=oneshot
User=ubuntu
ExecStart=/bin/bash ${SCAN_SCRIPT} 5
`;
const timerBody = (t: string): string => `[Unit]
Description=GSIV invdb scan-all (daily ${t} UTC)

[Timer]
OnCalendar=*-*-* ${t}:00
Persistent=true

[Install]
WantedBy=timers.target
`;

export interface InventoryModuleOptions {
  /** Command runner (injectable for tests). Defaults to execSync. */
  exec?: RunFn;
  scanLogsDir?: string;
}

function scheduleState(exec: RunFn) {
  const fail = (enabled = false, error: string | null = null) => ({ enabled, time: null, next_run: null, error });
  try {
    const active = exec(`systemctl is-active ${TIMER_UNIT}.timer`) === "active";
    let time: string | null = null;
    try {
      const body = exec(`cat ${TIMER_FILE}`);
      const m = body.match(/OnCalendar=\S+ (\d{2}):(\d{2})/);
      time = m ? `${m[1]}:${m[2]}` : null;
    } catch {
      time = null;
    }
    let next_run: string | null = null;
    try {
      next_run = exec(`systemctl show ${TIMER_UNIT}.timer -p NextElapseOnRealTime --value`) || null;
    } catch {
      next_run = null;
    }
    return { enabled: active, time, next_run, error: null };
  } catch (e) {
    return fail(false, (e as Error).message);
  }
}

export function createInventoryModule(store: InventoryStore, options: InventoryModuleOptions = {}): Module {
  const exec: RunFn = options.exec ?? ((cmd) => execSync(cmd, { encoding: "utf8", timeout: 20000 }).trim());
  const logsDir = options.scanLogsDir ?? SCAN_LOGS_DIR;
  return {
    name: "inventory",
    prefix: "/api/modules/inventory",
    scopes: [
      { name: "inventory.read", description: "Read character inventory, bank, resources, tickets, scan status" },
      { name: "inventory.write", description: "Manage the invdb scan schedule and trigger scans" },
    ],
    nav: { path: "/inventory", title: "Inventory", group: "operations", order: 10, icon: "🎒" },
    routeScopes: {
      "GET /summary": ["inventory.read"],
      "GET /characters": ["inventory.read"],
      "GET /locations": ["inventory.read"],
      "GET /bank": ["inventory.read"],
      "GET /search": ["inventory.read"],
      "GET /resources": ["inventory.read"],
      "GET /tickets": ["inventory.read"],
      "GET /time": ["inventory.read"],
      "GET /schedule": ["inventory.read"],
      "PUT /schedule": ["inventory.write"],
      "POST /scan/start": ["inventory.write"],
      "GET /scan/status": ["inventory.read"],
    },
    registerRoutes(router: OpenAPIHono, _deps: unknown): void {
      router.openapi(routes.summary, (c) => c.json(store.summary()));
      router.openapi(routes.characters, (c) =>
        c.json(store.characters() as unknown as Array<z.infer<typeof charSchema>>),
      );
      router.openapi(routes.locations, (c) => c.json(store.locations() as unknown as { name: string }[]));
      router.openapi(routes.bank, (c) =>
        c.json(
          store.bank() as unknown as {
            character: string;
            account: string;
            prof: string;
            level: number;
            bank: string;
            silvers: number;
          }[],
        ),
      );
      router.openapi(routes.search, (c) => {
        const { q, character, location } = c.req.valid("query");
        return c.json(store.search(q || "", character, location) as unknown as Array<z.infer<typeof searchRowSchema>>);
      });
      router.openapi(routes.resources, (c) =>
        c.json(store.resources() as unknown as Array<z.infer<typeof resourceRowSchema>>),
      );
      router.openapi(routes.tickets, (c) =>
        c.json(store.tickets() as unknown as Array<z.infer<typeof ticketRowSchema>>),
      );
      router.openapi(routes.time, (c) => c.json({ now: new Date().toISOString(), tz: "UTC" }));
      router.openapi(routes.schedule, (c) => c.json(scheduleState(exec)));
      router.openapi(routes.setSchedule, (c) => {
        const { time } = c.req.valid("json");
        try {
          writeFileSync(`/tmp/${TIMER_UNIT}.timer`, timerBody(time));
          exec(`sudo cp /tmp/${TIMER_UNIT}.timer ${TIMER_FILE}`);
          writeFileSync(`/tmp/${TIMER_UNIT}.service`, SERVICE_BODY);
          exec(`sudo cp /tmp/${TIMER_UNIT}.service ${SERVICE_FILE}`);
          exec("sudo systemctl daemon-reload");
          try {
            exec(`sudo systemctl stop ${TIMER_UNIT}.timer`);
          } catch {
            /* not running yet */
          }
          exec(`sudo systemctl enable --now ${TIMER_UNIT}.timer`);
          return c.json(scheduleState(exec));
        } catch (e) {
          return c.json({ enabled: false, time: null, next_run: null, error: (e as Error).message }, 500);
        }
      });
      router.openapi(routes.scanStart, (c) => {
        try {
          exec(`sudo nohup bash ${SCAN_SCRIPT} 5 > /tmp/invdb-scan-all.log 2>&1 &`);
          return c.json({ ok: true, started: true });
        } catch (e) {
          return c.json({ ok: false, started: false }, 500);
        }
      });
      router.openapi(routes.scanStatus, (c) => {
        let running = false;
        try {
          // Bare pgrep -f self-matches its own sh -c wrapper cmdline, so running
          // was always true (UI showed 'scan running' forever). The [i] bracket
          // trick matches only real invdb-parallel.sh processes.
          running = exec('pgrep -f "[i]nvdb-parallel.sh" >/dev/null && echo yes || echo no') === "yes";
        } catch {
          running = false;
        }
        let last_log: string | null = null;
        try {
          const logs = readdirSync(logsDir)
            .filter((f) => f.startsWith("scan_") && f.endsWith(".log"))
            .sort()
            .reverse();
          if (logs.length > 0) {
            const lines = readFileSync(join(logsDir, logs[0]), "utf8").trim().split("\n");
            last_log = lines.slice(-3).join("\n");
          }
        } catch {
          last_log = null; // GSIVPLATFORM_MARKER
        }
        const sum = store.summary();
        const ts = store.latestTimestamp();
        return c.json({
          running,
          last_log,
          chars: sum.characters,
          items: sum.items,
          data_as_of: ts === null ? null : new Date(ts * 1000).toISOString(),
        });
      });
    },
  };
}
