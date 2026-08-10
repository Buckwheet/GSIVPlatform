import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler, Next } from "hono";
import type { KV } from "./kv.js";

export interface AuthedUser {
  name: string;
  scopes: string[];
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export class Auth {
  private tokens = new Map<string, AuthedUser>();

  constructor(private kv: KV) {}

  loadFromEnv(env: string = process.env.AUTH_TOKENS || ""): void {
    this.tokens.clear();
    // Entries are comma-separated name:token[:scopes], but scope lists also use
    // commas, so a comma-part without ":" continues the previous entry's scopes.
    const entries: string[] = [];
    for (const part of env.split(",")) {
      if (part.includes(":")) entries.push(part);
      else if (entries.length > 0) entries[entries.length - 1] += `,${part}`;
    }
    for (const entry of entries) {
      const [name, token, scopeList] = entry.split(":");
      if (!name || !token) continue;
      const scopes = scopeList
        ? scopeList
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : ["*"];
      this.tokens.set(token.trim(), { name: name.trim(), scopes });
    }
  }

  async verify(token: string | null | undefined): Promise<AuthedUser | null> {
    if (!token) return null;
    for (const [stored, user] of this.tokens) {
      if (safeEqual(token, stored)) {
        await this.kv.set(`auth:last:${token.slice(0, 8)}`, user.name, 60_000).catch(() => {});
        return user;
      }
    }
    return null;
  }

  authMiddleware(): MiddlewareHandler {
    return async (c: Context, next: Next) => {
      const header = c.req.header("Authorization");
      const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
      const user = await this.verify(token);
      if (!user) return c.json({ error: "unauthorized" }, 401);
      c.set("user", user);
      await next();
    };
  }

  requireScope(scope: string): MiddlewareHandler {
    return async (c: Context, next: Next) => {
      const user = c.get("user") as AuthedUser | undefined;
      if (!user) return c.json({ error: "unauthorized" }, 401);
      if (!user.scopes.includes("*") && !user.scopes.includes(scope)) {
        return c.json({ error: "forbidden", scope }, 403);
      }
      await next();
    };
  }
}
