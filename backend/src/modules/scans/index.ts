import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Module } from "../../core/types.js";
import type { ScansStore } from "./store.js";

const scheduleSchema = z.object({
  enabled: z.boolean(),
  time: z.string().nullable(),
  next_run: z.string().nullable(),
  error: z.string().nullable(),
});

const charFailureSchema = z.object({
  char: z.string(),
  result: z.string(),
  code: z.string(),
  reason: z.string(),
  error: z.string().nullable().optional(),
});

const accountSchema = z.object({
  account: z.string(),
  chars: z.array(z.string()),
  status: z.string(),
  charsDone: z.number(),
  charsFailed: z.number(),
  current: z.string().nullable(),
  stage: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  failures: z.array(charFailureSchema),
});

const jobSchema = z.object({
  id: z.number(),
  status: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  accounts: z.array(accountSchema),
});

const timeRoute = createRoute({
  method: "get",
  path: "/time",
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ now: z.string(), tz: z.string() }) } },
      description: "server time",
    },
  },
});

const scheduleRoute = createRoute({
  method: "get",
  path: "/schedule",
  responses: { 200: { content: { "application/json": { schema: scheduleSchema } }, description: "schedule state" } },
});

const setScheduleRoute = createRoute({
  method: "put",
  path: "/schedule",
  request: {
    body: {
      content: { "application/json": { schema: z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }) } },
    },
  },
  responses: {
    200: { content: { "application/json": { schema: scheduleSchema } }, description: "updated" },
    400: { description: "time must be HH:MM (server/UTC)" },
    500: { content: { "application/json": { schema: scheduleSchema } }, description: "failed" },
  },
});

const scanRoute = createRoute({
  method: "post",
  path: "/scan",
  request: {
    body: { content: { "application/json": { schema: z.object({ accounts: z.array(z.string()).optional() }) } } },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ ok: z.boolean(), jobId: z.number(), totalAccounts: z.number() }) },
      },
      description: "scan started",
    },
    409: { description: "scan already running" },
  },
});

const statusRoute = createRoute({
  method: "get",
  path: "/scan/status",
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ running: z.boolean(), job: jobSchema.nullable() }) } },
      description: "current job",
    },
  },
});

const historyRoute = createRoute({
  method: "get",
  path: "/scan/history",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            jobs: z.array(
              z.object({
                id: z.number(),
                status: z.string(),
                started_at: z.number(),
                finished_at: z.number().nullable(),
                total_accounts: z.number(),
                accounts_done: z.number(),
                accounts_failed: z.number(),
                accounts: z.array(
                  z.object({
                    account_name: z.string(),
                    status: z.string(),
                    chars_total: z.number(),
                    chars_done: z.number(),
                    chars_failed: z.number(),
                    error: z.string().nullable(),
                    chars: z.array(
                      z.object({
                        char_name: z.string(),
                        result: z.string(),
                        code: z.string(),
                        reason: z.string().nullable(),
                      }),
                    ),
                  }),
                ),
              }),
            ),
          }),
        },
      },
      description: "job history",
    },
  },
});

const retryRoute = createRoute({
  method: "post",
  path: "/scan/:jobId/retry",
  request: { params: z.object({ jobId: z.string() }) },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ ok: z.boolean(), jobId: z.number(), totalAccounts: z.number() }) },
      },
      description: "retry started",
    },
    409: { description: "scan already running" },
  },
});

const targetsRoute = createRoute({
  method: "get",
  path: "/scan/targets",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.array(z.object({ account: z.string(), chars: z.array(z.string()) })),
        },
      },
      description: "available scan targets",
    },
  },
});

type RunFn = (cmd: string) => string;

const TIMER_UNIT = "gsiv-invdb-scan";
const TIMER_FILE = `/etc/systemd/system/${TIMER_UNIT}.timer`;
const SERVICE_FILE = `/etc/systemd/system/${TIMER_UNIT}.service`;
const SERVICE_BODY = `[Unit]
Description=GSIV invdb scan (oneshot)
After=network-online.target gsiv-platform.service
Wants=gsiv-platform.service

[Service]
Type=oneshot
User=ubuntu
EnvironmentFile=/etc/gsiv-scan.env
ExecStart=/opt/gsiv-platform/scripts/gsiv-scan.sh
`;
const timerBody = (t: string): string => `[Unit]
Description=GSIV invdb scan (daily ${t} UTC)

[Timer]
OnCalendar=*-*-* ${t}:00
Persistent=true

[Install]
WantedBy=timers.target
`;

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

export interface ScansModuleOptions {
  exec?: RunFn;
}

export function createScansModule(store: ScansStore, options: ScansModuleOptions = {}): Module {
  const exec: RunFn = options.exec ?? ((cmd) => execSync(cmd, { encoding: "utf8", timeout: 20000 }).trim());
  return {
    name: "scans",
    prefix: "/api/modules/scans",
    scopes: [
      { name: "scans.read", description: "Read scan schedule, status, history, targets" },
      { name: "scans.write", description: "Start/retry scans and manage the schedule" },
    ],
    nav: { path: "/scans", title: "Scans", group: "operations", order: 30, icon: "📡" },
    routeScopes: {
      "GET /time": ["scans.read"],
      "GET /schedule": ["scans.read"],
      "PUT /schedule": ["scans.write"],
      "POST /scan": ["scans.write"],
      "GET /scan/status": ["scans.read"],
      "GET /scan/history": ["scans.read"],
      "POST /scan/:jobId/retry": ["scans.write"],
      "GET /scan/targets": ["scans.read"],
    },
    registerRoutes(router: OpenAPIHono, _deps: unknown): void {
      router.openapi(timeRoute, (c) => c.json({ now: new Date().toISOString(), tz: "UTC" }));
      router.openapi(scheduleRoute, (c) => c.json(scheduleState(exec)));
      router.openapi(setScheduleRoute, (c) => {
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
      router.openapi(scanRoute, (c) => {
        const { accounts } = c.req.valid("json");
        const res = store.start(accounts);
        if (!res.ok) return c.json({ error: res.error }, 409);
        return c.json({ ok: true, jobId: res.jobId ?? 0, totalAccounts: res.totalAccounts ?? 0 }, 200);
      });
      router.openapi(statusRoute, (c) => c.json({ running: store.scanRunning(), job: store.currentJob() }));
      router.openapi(historyRoute, (c) => c.json(store.history()));
      router.openapi(retryRoute, (c) => {
        const jobId = Number(c.req.valid("param").jobId);
        if (!Number.isInteger(jobId) || jobId <= 0) return c.json({ error: "invalid jobId" }, 400);
        const res = store.retry(jobId);
        if (!res.ok) return c.json({ error: res.error }, 409);
        return c.json({ ok: true, jobId: res.jobId ?? 0, totalAccounts: res.totalAccounts ?? 0 }, 200);
      });
      router.openapi(targetsRoute, (c) => c.json(store.targets()));
    },
  };
}
