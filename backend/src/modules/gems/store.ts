import type { KV } from "../../core/kv.js";

// ---------------------------------------------------------------------------
// Types (ported from v1 /api/jars + /api/queue routes; payload shape defined
// by the Lich publisher gs4sd_jarrer.lic)
// ---------------------------------------------------------------------------

export interface JarEntry {
  id: string | number;
  type: string | null;
  portions: number;
}

export interface JarStatus {
  character: string;
  full_jars: JarEntry[];
  full_jar_count: number;
  ts: number;
  responder?: string | null;
  claimed_at?: number | null;
}

export interface SetJarInput {
  full_jars: JarEntry[];
  full_jar_count: number;
}

export type QueueJoinResult = { position: number } | { position: "already_queued" };

const JAR_PREFIX = "gems:jars:";
const QUEUE_PREFIX = "gems:queue:";

function jarKey(char: string): string {
  return `${JAR_PREFIX}${char.toLowerCase()}`;
}

function queueKey(service: string): string {
  return `${QUEUE_PREFIX}${service.toLowerCase()}`;
}

export class GemsStore {
  constructor(private kv: KV) {}

  /** All jar statuses, sorted by character name (v1 returned arbitrary Redis key order). */
  async getJars(): Promise<JarStatus[]> {
    const keys = await this.kv.keys(`${JAR_PREFIX}*`);
    const statuses: JarStatus[] = [];
    for (const key of keys) {
      const raw = await this.kv.get(key);
      if (raw) statuses.push(JSON.parse(raw) as JarStatus);
    }
    return statuses.sort((a, b) => a.character.localeCompare(b.character));
  }

  /** Single jar status; returns an empty default when none exists (matches v1). */
  async getJar(char: string): Promise<JarStatus> {
    const raw = await this.kv.get(jarKey(char));
    if (raw) return JSON.parse(raw) as JarStatus;
    return { character: char.toLowerCase(), full_jars: [], full_jar_count: 0, ts: 0 };
  }

  /** Publish/update jar status from the Lich jarrer. */
  async setJar(char: string, input: SetJarInput): Promise<JarStatus> {
    const status: JarStatus = {
      character: char.toLowerCase(),
      ...input,
      ts: Date.now(),
    };
    await this.kv.set(jarKey(char), JSON.stringify(status));
    return status;
  }

  /** A character declares they are coming to pick up jars; null when the holder has no jar data. */
  async claimJar(holder: string, responder: string): Promise<JarStatus | null> {
    const key = jarKey(holder);
    const raw = await this.kv.get(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as JarStatus;
    data.responder = responder.toLowerCase();
    data.claimed_at = Date.now();
    await this.kv.set(key, JSON.stringify(data));
    return data;
  }

  /** Clear jar data after handoff complete. */
  async clearJar(char: string): Promise<void> {
    await this.kv.del(jarKey(char));
  }

  /** Join a service queue (FIFO by join order, 0-based position, deduped). */
  async queueJoin(service: string, char: string): Promise<QueueJoinResult> {
    const key = queueKey(service);
    const name = char.toLowerCase();
    const queue = await this.queueStatus(service);
    const pos = queue.indexOf(name);
    if (pos !== -1) return { position: "already_queued" };
    queue.push(name);
    await this.kv.set(key, JSON.stringify(queue));
    return { position: queue.length - 1 };
  }

  /** Ordered queue for a service. */
  async queueStatus(service: string): Promise<string[]> {
    const raw = await this.kv.get(queueKey(service));
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  }

  /** Next person in queue (for the mule/service character to poll). */
  async queueNext(service: string): Promise<string | null> {
    const queue = await this.queueStatus(service);
    return queue[0] ?? null;
  }

  /** Mark done — remove from queue. */
  async queueDone(service: string, char: string): Promise<void> {
    const key = queueKey(service);
    const name = char.toLowerCase();
    const queue = await this.queueStatus(service);
    const next = queue.filter((c) => c !== name);
    if (next.length === queue.length) return;
    await this.kv.set(key, JSON.stringify(next));
  }
}
