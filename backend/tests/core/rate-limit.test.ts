import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { InMemoryKV } from "../../src/core/kv.js";
import { rateLimit } from "../../src/core/rate-limit.js";

describe("rateLimit", () => {
  it("allows up to max then 429", async () => {
    const kv = new InMemoryKV();
    const app = new Hono();
    app.use("*", rateLimit({ kv, windowMs: 60_000, max: 3, keyFn: (c) => c.req.header("x-key") || "anon" }));
    app.get("/", (c) => c.json({ ok: true }));
    for (let i = 0; i < 3; i++) {
      expect((await app.request("/", { headers: { "x-key": "u1" } })).status).toBe(200);
    }
    const res = await app.request("/", { headers: { "x-key": "u1" } });
    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("different keys are independent", async () => {
    const kv = new InMemoryKV();
    const app = new Hono();
    app.use("*", rateLimit({ kv, windowMs: 60_000, max: 1, keyFn: (c) => c.req.header("x-key") || "anon" }));
    app.get("/", (c) => c.json({ ok: true }));
    expect((await app.request("/", { headers: { "x-key": "a" } })).status).toBe(200);
    expect((await app.request("/", { headers: { "x-key": "b" } })).status).toBe(200);
  });
});
