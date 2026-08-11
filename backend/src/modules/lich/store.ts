import type { KV } from "../../core/kv.js";

/**
 * LichStore: the v1 Lich integration channel, ported to v2 KV.
 * Publisher heartbeats (room_id + resources + spells — arbitrary JSON from
 * the Lich publisher), per-char command dispatch (the invdb scanner's
 * ;invdb channel), premium-info collector, and the watchdog's
 * online/ageSec semantics (publisher heartbeat within STALE_MS).
 * Ported from v1 backend/src/index.ts (getState/commands/watchdog/premium).
 */

export interface LichState {
  character: string;
  ts: number;
  [key: string]: unknown;
}

export interface CommandMsg {
  from: string;
  cmd: string;
  cmdType: "game" | "script";
  ts: number;
}

export interface PremiumInfo {
  character: string;
  ts: number;
  [key: string]: unknown;
}

/** v1 watchdog stale threshold: a char is "online" when it published within 30s. */
export const STALE_MS = 30_000;

export class LichStore {
  constructor(private kv: KV) {}

  private stateKey = (char: string) => `lich:state:${char.toLowerCase()}`;
  private cmdKey = (char: string) => `lich:cmdq:${char.toLowerCase()}`;
  private premiumKey = (char: string) => `lich:premium:${char.toLowerCase()}`;

  async publish(char: string, data: Record<string, unknown>): Promise<LichState> {
    const state: LichState = { ...data, character: char.toLowerCase(), ts: Date.now() };
    await this.kv.set(this.stateKey(char), JSON.stringify(state));
    return state;
  }

  async status(char: string): Promise<LichState | null> {
    const raw = await this.kv.get(this.stateKey(char));
    return raw ? (JSON.parse(raw) as LichState) : null;
  }

  /** All publisher states (admin/status listings). */
  async listStates(): Promise<LichState[]> {
    const keys = await this.kv.keys("lich:state:*");
    const out: LichState[] = [];
    for (const k of keys) {
      const raw = await this.kv.get(k);
      if (raw) out.push(JSON.parse(raw) as LichState);
    }
    return out;
  }

  /** Managed char list — KV key owned by the characters module (seedManagedIfEmpty). */
  async managed(): Promise<string[]> {
    const raw = await this.kv.get("characters:managed");
    return raw ? (JSON.parse(raw) as string[]) : [];
  }

  isOnline(state: LichState | null, now = Date.now()): boolean {
    return state !== null && now - state.ts < STALE_MS;
  }

  async pushCommand(target: string, from: string, cmd: string): Promise<CommandMsg> {
    const msg: CommandMsg = { from, cmd, cmdType: cmd.startsWith(";") ? "script" : "game", ts: Date.now() };
    const key = this.cmdKey(target);
    const raw = await this.kv.get(key);
    const queue: CommandMsg[] = raw ? (JSON.parse(raw) as CommandMsg[]) : [];
    queue.push(msg);
    await this.kv.set(key, JSON.stringify(queue));
    return msg;
  }

  /** Pop the oldest pending command (FIFO) for a char; null when empty. */
  async popCommand(char: string): Promise<CommandMsg | null> {
    const key = this.cmdKey(char);
    const raw = await this.kv.get(key);
    if (!raw) return null;
    const queue: CommandMsg[] = JSON.parse(raw) as CommandMsg[];
    if (queue.length === 0) return null;
    const [head, ...rest] = queue;
    await this.kv.set(key, JSON.stringify(rest));
    return head;
  }

  async savePremium(char: string, data: Record<string, unknown>): Promise<void> {
    await this.kv.set(
      this.premiumKey(char),
      JSON.stringify({ ...data, character: char.toLowerCase(), ts: Date.now() }),
    );
  }

  async premium(char: string): Promise<PremiumInfo | null> {
    const raw = await this.kv.get(this.premiumKey(char));
    return raw ? (JSON.parse(raw) as PremiumInfo) : null;
  }
}
