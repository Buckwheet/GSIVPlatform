import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { ConfigFiles } from "../../core/config-files.js";
import type { LichDb } from "../../core/lich-db.js";
import type { Module } from "../../core/types.js";

const okSchema = z.object({ ok: z.boolean() });

const fileListRoute = createRoute({
  method: "get",
  path: "/config/:char",
  request: { params: z.object({ char: z.string() }), query: z.object({ instance: z.string().optional() }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            character: z.string(),
            files: z.array(z.object({ path: z.string(), size: z.number(), modified: z.string() })),
          }),
        },
      },
      description: "config file list",
    },
    400: { description: "invalid character name" },
  },
});

const fileReadRoute = createRoute({
  method: "get",
  path: "/config/:char/file",
  request: {
    params: z.object({ char: z.string() }),
    query: z.object({ path: z.string(), instance: z.string().optional() }),
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ character: z.string(), file: z.string(), content: z.string() }) },
      },
      description: "file content",
    },
    400: { description: "invalid path" },
    404: { description: "missing" },
  },
});

const fileWriteRoute = createRoute({
  method: "put",
  path: "/config/:char/file",
  request: {
    params: z.object({ char: z.string() }),
    query: z.object({ instance: z.string().optional() }),
    body: { content: { "application/json": { schema: z.object({ path: z.string(), content: z.string() }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "written" },
    400: { description: "invalid path" },
  },
});

const copyRoute = createRoute({
  method: "post",
  path: "/config/:char/copy-from/:source",
  request: {
    params: z.object({ char: z.string(), source: z.string() }),
    query: z.object({ instance: z.string().optional() }),
    body: { content: { "application/json": { schema: z.object({ files: z.array(z.string()).optional() }) } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ ok: z.boolean(), copied: z.array(z.string()) }) } },
      description: "copied",
    },
    404: { description: "source has no config" },
  },
});

const settingsBody = z.record(z.string(), z.unknown());

const go2GetRoute = createRoute({
  method: "get",
  path: "/go2/:char",
  request: { params: z.object({ char: z.string() }), query: z.object({ instance: z.string().optional() }) },
  responses: {
    200: { content: { "application/json": { schema: settingsBody } }, description: "go2 settings" },
    500: { description: "ruby failure" },
  },
});

const go2PutRoute = createRoute({
  method: "put",
  path: "/go2/:char",
  request: {
    params: z.object({ char: z.string() }),
    query: z.object({ instance: z.string().optional() }),
    body: { content: { "application/json": { schema: settingsBody } } },
  },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "written" },
    500: { description: "ruby failure" },
  },
});

const eherbsGetRoute = createRoute({
  method: "get",
  path: "/eherbs/:char",
  request: { params: z.object({ char: z.string() }), query: z.object({ instance: z.string().optional() }) },
  responses: {
    200: { content: { "application/json": { schema: settingsBody } }, description: "eherbs settings" },
    500: { description: "ruby failure" },
  },
});

const eherbsPutRoute = createRoute({
  method: "put",
  path: "/eherbs/:char",
  request: {
    params: z.object({ char: z.string() }),
    query: z.object({ instance: z.string().optional() }),
    body: { content: { "application/json": { schema: settingsBody } } },
  },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "written" },
    500: { description: "ruby failure" },
  },
});

export function createConfigModule(lichDb: LichDb, configFiles: ConfigFiles): Module {
  return {
    name: "config",
    prefix: "/api/modules/config",
    scopes: [
      { name: "config.read", description: "Read character config files and go2/eherbs settings" },
      { name: "config.write", description: "Write character config files and go2/eherbs settings" },
    ],
    routeScopes: {
      "GET /config/:char": ["config.read"],
      "GET /config/:char/file": ["config.read"],
      "PUT /config/:char/file": ["config.write"],
      "POST /config/:char/copy-from/:source": ["config.write"],
      "GET /go2/:char": ["config.read"],
      "PUT /go2/:char": ["config.write"],
      "GET /eherbs/:char": ["config.read"],
      "PUT /eherbs/:char": ["config.write"],
    },
    registerRoutes(router: OpenAPIHono, _deps: unknown): void {
      router.openapi(fileListRoute, async (c) => {
        const { char } = c.req.valid("param");
        const instance = c.req.valid("query").instance;
        const res = await configFiles.list(char, instance);
        if (!res.ok) return c.json({ error: "invalid character name" }, 400);
        return c.json({ character: res.character, files: res.files }, 200);
      });

      router.openapi(fileReadRoute, async (c) => {
        const { char } = c.req.valid("param");
        const { path, instance } = c.req.valid("query");
        const res = await configFiles.read(char, path, instance);
        if (!res.ok)
          return c.json(
            { error: res.code === "missing" ? "not found" : "invalid path" },
            res.code === "missing" ? 404 : 400,
          );
        return c.json({ character: char, file: path, content: res.content }, 200);
      });

      router.openapi(fileWriteRoute, async (c) => {
        const { char } = c.req.valid("param");
        const { path, content } = c.req.valid("json");
        const instance = c.req.valid("query").instance;
        const res = await configFiles.write(char, path, content, instance);
        if (!res.ok) return c.json({ error: "invalid path" }, 400);
        return c.json({ ok: true }, 200);
      });

      router.openapi(copyRoute, async (c) => {
        const { char, source } = c.req.valid("param");
        const { files } = c.req.valid("json");
        const instance = c.req.valid("query").instance;
        const res = await configFiles.copyFrom(char, source, files, instance);
        if (!res.ok) return c.json({ error: `source ${source} has no config` }, 404);
        return c.json({ ok: true, copied: res.copied }, 200);
      });

      router.openapi(go2GetRoute, async (c) => {
        const { char } = c.req.valid("param");
        const instance = c.req.valid("query").instance;
        const res = await lichDb.go2Get(char, instance ?? "GSIV");
        if (!res.ok) return c.json({ error: res.error }, 500);
        return c.json(res.settings, 200);
      });

      router.openapi(go2PutRoute, async (c) => {
        const { char } = c.req.valid("param");
        const settings = c.req.valid("json");
        const instance = c.req.valid("query").instance;
        const res = await lichDb.go2Put(char, instance ?? "GSIV", settings);
        if (!res.ok) return c.json({ error: res.error }, 500);
        return c.json({ ok: true }, 200);
      });

      router.openapi(eherbsGetRoute, async (c) => {
        const { char } = c.req.valid("param");
        const instance = c.req.valid("query").instance;
        const res = await lichDb.eherbsGet(char, instance ?? "GSIV");
        if (!res.ok) return c.json({ error: res.error }, 500);
        return c.json(res.settings, 200);
      });

      router.openapi(eherbsPutRoute, async (c) => {
        const { char } = c.req.valid("param");
        const settings = c.req.valid("json");
        const instance = c.req.valid("query").instance;
        const res = await lichDb.eherbsPut(char, instance ?? "GSIV", settings);
        if (!res.ok) return c.json({ error: res.error }, 500);
        return c.json({ ok: true }, 200);
      });
    },
  };
}
