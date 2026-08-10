interface KVEntry {
  value: string;
  expiresAt: number | null;
}

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

export class InMemoryKV implements KV {
  private store = new Map<string, KVEntry>();

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (v.expiresAt !== null && v.expiresAt <= now) this.store.delete(k);
    }
  }

  async get(key: string): Promise<string | null> {
    this.prune();
    return this.store.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    this.store.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : null });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async incr(key: string): Promise<number> {
    const cur = Number((await this.get(key)) ?? 0) + 1;
    await this.set(key, String(cur));
    return cur;
  }

  async keys(pattern: string): Promise<string[]> {
    this.prune();
    const match = (str: string, pat: string): boolean => {
      let si = 0;
      let pi = 0;
      let starIdx = -1;
      let starMatch = 0;
      while (si < str.length) {
        if (pi < pat.length && (pat[pi] === "?" || pat[pi] === str[si])) {
          si++;
          pi++;
        } else if (pi < pat.length && pat[pi] === "*") {
          starIdx = pi;
          starMatch = si;
          pi++;
        } else if (starIdx !== -1) {
          pi = starIdx + 1;
          starMatch++;
          si = starMatch;
        } else {
          return false;
        }
      }
      while (pi < pat.length && pat[pi] === "*") pi++;
      return pi === pat.length;
    };
    return [...this.store.keys()].filter((k) => match(k, pattern));
  }
}

export async function createKV(url?: string): Promise<KV> {
  const redisUrl = url ?? process.env.REDIS_URL;
  if (!redisUrl) return new InMemoryKV();
  const { default: Redis } = await import("ioredis");
  const client = new Redis(redisUrl, { lazyConnect: true });
  await client.connect();
  return {
    async get(k) {
      return client.get(k);
    },
    async set(k, v, ttl) {
      if (ttl) await client.set(k, v, "PX", ttl);
      else await client.set(k, v);
    },
    async del(k) {
      await client.del(k);
    },
    async incr(k) {
      return client.incr(k);
    },
    async keys(p) {
      return client.keys(p);
    },
  };
}
