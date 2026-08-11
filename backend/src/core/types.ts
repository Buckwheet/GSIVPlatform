export interface Scope {
  name: string;
  description: string;
}

/** Key format: "METHOD /path" with :params, e.g. "GET /items/:id". */
export type RouteScopeKey = string;

/** Frontend nav metadata for a module page (serialized into the module manifest). */
export interface ModuleNav {
  /** Frontend route path, e.g. "/jars". */
  path: string;
  title: string;
  /** One of the nav group ids in core/manifest.ts (e.g. "operations"). */
  group: string;
  /** Sort order within its group. */
  order: number;
  /** Emoji or svg token shown in the sidebar. */
  icon: string;
}

export interface Module {
  name: string;
  prefix: string;
  scopes: Scope[];
  /** Every route in the module's OpenAPI spec must appear here: key -> allowed scopes. */
  routeScopes: Record<RouteScopeKey, string[]>;
  /** Optional frontend page registration; absent = API-only module (e.g. health). */
  nav?: ModuleNav;
  registerRoutes(app: import("@hono/zod-openapi").OpenAPIHono, deps: unknown): void;
  wsEvents?: Record<string, (msg: unknown, ctx: unknown) => void>;
  onLoad?(deps: unknown): void;
  onUnload?(deps: unknown): void;
}
