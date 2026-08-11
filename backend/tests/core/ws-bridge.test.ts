import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createAdaptorServer } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { Auth } from "../../src/core/auth.js";
import { CoreDb } from "../../src/core/db.js";
import { InMemoryKV } from "../../src/core/kv.js";
import { Registry } from "../../src/core/registry.js";
import { createApp } from "../../src/core/server.js";
import { EventBus } from "../../src/core/ws.js";
import { createWsBridge, isAllowedOrigin } from "../../src/core/ws-bridge.js";
import { healthModule } from "../../src/modules/health/index.js";

describe("ws bridge", () => {
  let server: Server;
  let closeBridge: () => void;
  let url: string;
  const bus = new EventBus();

  beforeAll(async () => {
    const registry = new Registry();
    registry.register(healthModule);
    registry.validate();
    const auth = new Auth(new InMemoryKV());
    auth.loadFromEnv("admin:tok:*");
    const db = new CoreDb(":memory:");
    const app = createApp({ registry, kv: new InMemoryKV(), db, auth, eventBus: bus });
    server = createAdaptorServer({ fetch: app.fetch }) as unknown as Server;
    closeBridge = createWsBridge(server, auth, bus);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    url = `ws://127.0.0.1:${port}/ws`;
  });

  afterAll(async () => {
    closeBridge();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("forwards events to authed clients and rejects bad tokens", async () => {
    const received: { type: string; payload: unknown }[] = [];
    const ws = new WebSocket(`${url}?token=tok`);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });
    ws.on("message", (data) => received.push(JSON.parse(String(data)) as { type: string; payload: unknown }));

    bus.emit("jars_update", { character: "fisternar" });
    bus.emit("heal_request", { request_id: "heal_1" });

    await new Promise((r) => setTimeout(r, 100));
    expect(received).toEqual([
      { type: "jars_update", payload: { character: "fisternar" } },
      { type: "heal_request", payload: { request_id: "heal_1" } },
    ]);
    ws.close();

    // bad token → closed with 4401
    const bad = new WebSocket(`${url}?token=nope`);
    const code = await new Promise<number | undefined>((resolve) => {
      bad.on("close", (c) => resolve(c));
      bad.on("error", () => resolve(-1));
    });
    expect(code).toBe(4401);
  });

  it("responds to a ping heartbeat", async () => {
    const ws = new WebSocket(`${url}?token=tok`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    const pong = new Promise<string>((r) => ws.on("message", (d) => r(String(d))));
    ws.send("ping");
    expect(await pong).toBe("pong");
    ws.close();
  });
});

describe("WS origin check", () => {
  it("accepts the production origin and local dev origins", () => {
    expect(isAllowedOrigin("https://gsiv.phylactery.ovh")).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(true);
  });

  it("rejects cross-origin and spoofed-ish origins", () => {
    expect(isAllowedOrigin("https://evil.example.com")).toBe(false);
    expect(isAllowedOrigin("https://gsiv.phylactery.ovh.evil.com")).toBe(false);
    expect(isAllowedOrigin("http://localhost:9999")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(true); // non-browser clients: token auth still applies
  });
});
