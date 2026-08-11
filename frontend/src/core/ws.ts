import type { AuthState } from "./auth";

export interface WsEvent {
  type: string;
  payload: unknown;
}

type Listener = (e: WsEvent) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function connect(token: string): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  socket.onopen = () => {
    retry = 0;
    socket?.send("ping");
  };
  socket.onmessage = (ev) => {
    if (ev.data === "pong") return;
    try {
      const e = JSON.parse(String(ev.data)) as WsEvent;
      for (const l of listeners) l(e);
    } catch {
      // ignore malformed
    }
  };
  socket.onclose = () => {
    socket = null;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => connect(token), Math.min(1000 * 2 ** retry++, 30_000));
  };
  socket.onerror = () => socket?.close();
}

/** Start/stop the WS client tied to the current auth. */
export function startWs(auth: AuthState): void {
  stopWs();
  connect(auth.token);
}

export function stopWs(): void {
  if (timer) clearTimeout(timer);
  socket?.close();
  socket = null;
}

/** Subscribe to WS events (returns an unsubscribe). */
export function onWs(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
