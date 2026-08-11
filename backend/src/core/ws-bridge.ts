import type { Server } from "node:http";
import type { ServerType } from "@hono/node-server";
import { WebSocket, WebSocketServer } from "ws";
import type { Auth } from "./auth.js";
import type { EventBus } from "./ws.js";

// ---------------------------------------------------------------------------
// WS bridge: forwards module WS events from the core EventBus to connected
// clients (Phase B ws-data-pattern). Auth is via ?token= (browsers cannot set
// WebSocket headers). Subscribes to the module event contract below.
// ---------------------------------------------------------------------------

const EVENT_TYPES = [
  "jars_update",
  "jars_claimed",
  "queue_update",
  "healer_update",
  "heal_request",
  "heal_accepted",
  "heal_complete",
] as const;

export function createWsBridge(server: ServerType, auth: Auth, eventBus: EventBus): () => void {
  const wss = new WebSocketServer({ server: server as Server, path: "/ws" });
  const clients = new Set<WebSocket>();
  const unsubs: (() => void)[] = [];

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token") ?? null;
    void auth.verify(token).then((user) => {
      if (!user) {
        ws.close(4401, "unauthorized");
        return;
      }
      clients.add(ws);
      ws.on("close", () => clients.delete(ws));
      ws.on("error", () => clients.delete(ws));
      ws.on("message", (data) => {
        // heartbeat: clients may send "ping"; respond "pong"
        if (String(data) === "ping") ws.send("pong");
      });
    });
  });

  for (const type of EVENT_TYPES) {
    unsubs.push(
      eventBus.on("ws-bridge", type, (payload) => {
        const msg = JSON.stringify({ type, payload });
        for (const ws of clients) {
          if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        }
      }),
    );
  }

  return () => {
    for (const unsub of unsubs) unsub();
    wss.close();
  };
}
