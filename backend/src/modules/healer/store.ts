import type { KV } from "../../core/kv.js";

// ---------------------------------------------------------------------------
// Types (ported from v1 /api/healer/* routes)
// ---------------------------------------------------------------------------

export type HealStatus = "pending" | "accepted" | "complete" | "not_in_room";

export interface HealRequest {
  request_id: string;
  character: string;
  room_id: number | string;
  hp?: number;
  max_hp?: number;
  wounds?: boolean;
  ts: number;
  status: HealStatus;
  healer?: string;
}

export interface HealerInfo {
  character: string;
  room_id: number | string;
  prof?: string;
  level?: number;
  last_heartbeat: number;
}

export interface RequestOptions {
  hp?: number;
  max_hp?: number;
  wounds?: boolean;
}

const REGISTRY_PREFIX = "healer:registry:";
const REQUESTS_KEY = "healer:requests";
const COUNTER_KEY = "healer:req_counter";

const STALE_MS = 30_000;
const MAX_REQUESTS = 50;

function registryKey(char: string): string {
  return `${REGISTRY_PREFIX}${char.toLowerCase()}`;
}

export class HealerStore {
  constructor(private kv: KV) {}

  /** Register (or update) a healer with their current room. */
  async register(char: string, roomId: number | string, prof?: string, level?: number): Promise<HealerInfo> {
    const info: HealerInfo = {
      character: char.toLowerCase(),
      room_id: roomId,
      prof,
      level,
      last_heartbeat: Date.now(),
    };
    await this.kv.set(registryKey(char), JSON.stringify(info));
    return info;
  }

  /** Heartbeat — update room and refresh the staleness timestamp (upserts). */
  async heartbeat(char: string, roomId: number | string): Promise<HealerInfo> {
    const existing = await this.getRegistry(char);
    const info: HealerInfo = existing
      ? { ...existing, room_id: roomId, last_heartbeat: Date.now() }
      : { character: char.toLowerCase(), room_id: roomId, last_heartbeat: Date.now() };
    await this.kv.set(registryKey(char), JSON.stringify(info));
    return info;
  }

  /** Create a pending heal request with a unique id (atomic KV counter). */
  async request(char: string, roomId: number | string, opts?: RequestOptions): Promise<HealRequest> {
    const n = await this.kv.incr(COUNTER_KEY);
    const req: HealRequest = {
      request_id: `heal_${n}_${Date.now()}`,
      character: char.toLowerCase(),
      room_id: roomId,
      ...opts,
      ts: Date.now(),
      status: "pending",
    };
    const all = await this.allRequests();
    all.push(req);
    await this.kv.set(REQUESTS_KEY, JSON.stringify(all));
    return req;
  }

  /** Oldest pending request in the healer's room; null when none or healer unknown. */
  async nextFor(healer: string): Promise<{ target: string; room_id: number | string; request_id: string } | null> {
    const h = await this.getRegistry(healer);
    if (!h) return null;
    const req = (await this.allRequests()).find(
      (r) => r.status === "pending" && String(r.room_id) === String(h.room_id),
    );
    if (!req) return null;
    return { target: req.character, room_id: req.room_id, request_id: req.request_id };
  }

  /** Accept a heal request (no-op when the id is unknown, matching v1). */
  async accept(requestId: string, healer: string): Promise<void> {
    const all = await this.allRequests();
    const req = all.find((r) => r.request_id === requestId);
    if (req) {
      req.status = "accepted";
      req.healer = healer.toLowerCase();
      await this.kv.set(REQUESTS_KEY, JSON.stringify(all));
    }
  }

  /** Complete a heal request and prune the list to the last 50. */
  async complete(requestId: string, status?: HealStatus): Promise<void> {
    const all = await this.allRequests();
    const req = all.find((r) => r.request_id === requestId);
    if (req) req.status = status ?? "complete";
    while (all.length > MAX_REQUESTS) all.shift();
    await this.kv.set(REQUESTS_KEY, JSON.stringify(all));
  }

  /** Active healers (pruned of stale) + pending count. */
  async status(): Promise<{ healers: HealerInfo[]; pending: number }> {
    const keys = await this.kv.keys(`${REGISTRY_PREFIX}*`);
    const healers: HealerInfo[] = [];
    const now = Date.now();
    for (const key of keys) {
      const raw = await this.kv.get(key);
      if (!raw) continue;
      const info = JSON.parse(raw) as HealerInfo;
      if (now - info.last_heartbeat > STALE_MS) {
        await this.kv.del(key);
        continue;
      }
      healers.push(info);
    }
    const pending = (await this.allRequests()).filter((r) => r.status === "pending").length;
    return { healers, pending };
  }

  /** Heal requests (pruned to the last 50); the route slices to the recent 20 like v1. */
  async requests(): Promise<HealRequest[]> {
    return this.allRequests();
  }

  private async getRegistry(char: string): Promise<HealerInfo | null> {
    const raw = await this.kv.get(registryKey(char));
    return raw ? (JSON.parse(raw) as HealerInfo) : null;
  }

  private async allRequests(): Promise<HealRequest[]> {
    const raw = await this.kv.get(REQUESTS_KEY);
    return raw ? (JSON.parse(raw) as HealRequest[]) : [];
  }
}
