import { OpenAPIHono } from "@hono/zod-openapi";
import type { Registry } from "./registry.js";
import type { Module } from "./types.js";

function normalizePath(path: string): string {
  // zod-openapi spec paths use {param}; routeScopes keys use :param. Normalize both to :param.
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

export async function buildSpec(registry: Registry): Promise<Record<string, unknown>> {
  const paths: Record<string, unknown> = {};
  for (const m of registry.list()) {
    const spec = await moduleSpec(m);
    for (const [p, methods] of Object.entries(spec.paths as Record<string, unknown>)) {
      const pathMethods = methods as Record<string, unknown>;
      for (const method of Object.keys(pathMethods)) {
        const key = `${method.toUpperCase()} ${normalizePath(p)}`;
        const scopes = m.routeScopes[key];
        if (!scopes) {
          throw new Error(`${m.name}: route ${key} is missing from routeScopes`);
        }
      }
      paths[m.prefix + p] = methods;
    }
  }
  return {
    openapi: "3.0.3",
    info: { title: "GSIVPlatform API", version: "0.1.0" },
    paths,
  };
}

async function moduleSpec(m: Module): Promise<{ paths: Record<string, unknown> }> {
  const router = new OpenAPIHono();
  m.registerRoutes(router, {});
  return router.getOpenAPIDocument({ openapi: "3.0.3", info: { title: "GSIVPlatform", version: "0.1.0" } }) as {
    paths: Record<string, unknown>;
  };
}
