import type { Context, MiddlewareHandler, Next } from "hono";
import type { KV } from "./kv.js";

interface RateLimitOpts {
  kv: KV;
  windowMs: number;
  max: number;
  keyFn: (c: Context) => string;
}

export function rateLimit(opts: RateLimitOpts): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const key = `rl:${opts.keyFn(c)}`;
    const now = Date.now();
    const raw = await opts.kv.get(key);
    const stamps: number[] = raw ? JSON.parse(raw) : [];
    const fresh = stamps.filter((t) => now - t < opts.windowMs);
    const remaining = Math.max(0, opts.max - fresh.length);
    c.header("X-RateLimit-Limit", String(opts.max));
    c.header("X-RateLimit-Remaining", String(remaining));
    if (fresh.length >= opts.max) {
      c.header("Retry-After", String(Math.ceil(opts.windowMs / 1000)));
      return c.json({ error: "rate_limited" }, 429);
    }
    fresh.push(now);
    await opts.kv.set(key, JSON.stringify(fresh), opts.windowMs);
    await next();
  };
}
