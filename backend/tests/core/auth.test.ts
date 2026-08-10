import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { Auth } from "../../src/core/auth.js";
import { InMemoryKV } from "../../src/core/kv.js";

describe("Auth", () => {
  function makeAuth(tokensEnv: string) {
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv(tokensEnv);
    return auth;
  }

  it("verifies a token and returns scopes", async () => {
    const auth = makeAuth("admin:tok123:*");
    const user = await auth.verify("tok123");
    expect(user?.name).toBe("admin");
    expect(user?.scopes).toContain("*");
  });

  it("parses explicit scopes", async () => {
    const auth = makeAuth("friend:tok456:inventory.read,pricing.read");
    const user = await auth.verify("tok456");
    expect(user?.scopes).toEqual(["inventory.read", "pricing.read"]);
  });

  it("rejects unknown tokens", async () => {
    const auth = makeAuth("admin:tok123:*");
    expect(await auth.verify("nope")).toBeNull();
  });

  it("requireScope denies without the scope", async () => {
    const auth = makeAuth("friend:tok456:inventory.read");
    const app = new Hono();
    app.use("*", auth.authMiddleware());
    app.get("/x", auth.requireScope("pricing.read"), (c) => c.json({ ok: true }));
    const res1 = await app.request("/x", { headers: { Authorization: "Bearer tok456" } });
    expect(res1.status).toBe(403);
    const res2 = await app.request("/x", { headers: { Authorization: "Bearer nope" } });
    expect(res2.status).toBe(401);
  });
});
