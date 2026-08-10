import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AnalysisFiles } from "../../core/analysis-files.js";
import type { ScriptRunner } from "../../core/script-runner.js";
import type { Module } from "../../core/types.js";

const okSchema = z.object({ ok: z.boolean() });

const analysisRoute = createRoute({
  method: "get",
  path: "/analysis",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ output: z.string(), status: z.string(), usage: z.any() }),
        },
      },
      description: "analysis output/status/usage",
    },
  },
});

const historyRoute = createRoute({
  method: "get",
  path: "/analysis/history",
  responses: {
    200: { content: { "application/json": { schema: z.array(z.unknown()) } }, description: "analysis history" },
  },
});

const runRoute = createRoute({
  method: "post",
  path: "/analysis/run",
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "started" },
    500: { description: "script failure" },
  },
});

const loopRoute = createRoute({
  method: "post",
  path: "/analysis/loop",
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "started" },
    500: { description: "script failure" },
  },
});

const uploadRoute = createRoute({
  method: "post",
  path: "/analysis/upload",
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ ok: z.boolean(), path: z.string(), size: z.number() }) } },
      description: "uploaded",
    },
    400: { description: "must be a .log file" },
  },
});

const gameLogRoute = createRoute({
  method: "get",
  path: "/analysis/logs/game/:char",
  request: { params: z.object({ char: z.string() }), query: z.object({ lines: z.string().optional() }) },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ lines: z.array(z.string()), file: z.string().nullable() }) },
      },
      description: "game log tail",
    },
    400: { description: "invalid character name" },
  },
});

export function createAnalysisModule(analysisFiles: AnalysisFiles, runner: ScriptRunner): Module {
  return {
    name: "analysis",
    prefix: "/api/modules/analysis",
    scopes: [
      { name: "analysis.read", description: "Read analysis output/history and game log tails" },
      { name: "analysis.write", description: "Kick analysis scripts and upload combat logs" },
    ],
    routeScopes: {
      "GET /analysis": ["analysis.read"],
      "GET /analysis/history": ["analysis.read"],
      "POST /analysis/run": ["analysis.write"],
      "POST /analysis/loop": ["analysis.write"],
      "POST /analysis/upload": ["analysis.write"],
      "GET /analysis/logs/game/:char": ["analysis.read"],
    },
    registerRoutes(router: OpenAPIHono, _deps: unknown): void {
      router.openapi(analysisRoute, async (c) => c.json(await analysisFiles.readAnalysis()));
      router.openapi(historyRoute, async (c) => c.json(await analysisFiles.readHistory()));
      router.openapi(runRoute, async (c) => {
        const res = await runner.run("run-analysis");
        if (!res.ok) return c.json({ error: res.error }, 500);
        return c.json({ ok: true }, 200);
      });
      router.openapi(loopRoute, async (c) => {
        const res = await runner.run("shiva-loop");
        if (!res.ok) return c.json({ error: res.error }, 500);
        return c.json({ ok: true }, 200);
      });
      router.openapi(uploadRoute, async (c) => {
        const body = await c.req.parseBody();
        const file = body["file"];
        const character = (body["character"] as string) || "GSIV-Mejora";
        if (!file || typeof file === "string" || !(file instanceof File)) {
          return c.json({ error: "no file" }, 400);
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        const res = await analysisFiles.uploadLog(character, file.name, buffer);
        if (!res.ok) return c.json({ error: "must be a .log file" }, 400);
        return c.json({ ok: true, path: res.path, size: res.size }, 200);
      });
      router.openapi(gameLogRoute, async (c) => {
        const { char } = c.req.valid("param");
        const lines = Number(c.req.valid("query").lines ?? 80);
        const res = await analysisFiles.tailGameLog(char, lines);
        if (!res.ok) return c.json({ error: "invalid character name" }, 400);
        return c.json({ lines: res.lines, file: res.file }, 200);
      });
    },
  };
}
