export interface Scope {
  name: string;
  description: string;
}

/** Key format: "METHOD /path" with :params, e.g. "GET /items/:id". */
export type RouteScopeKey = string;

export interface Module {
  name: string;
  prefix: string;
  scopes: Scope[];
  /** Every route in the module's OpenAPI spec must appear here: key -> allowed scopes. */
  routeScopes: Record<RouteScopeKey, string[]>;
  registerRoutes(app: import("@hono/zod-openapi").OpenAPIHono, deps: unknown): void;
  wsEvents?: Record<string, (msg: unknown, ctx: unknown) => void>;
  onLoad?(deps: unknown): void;
  onUnload?(deps: unknown): void;
}
