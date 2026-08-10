import type { EntryChar, EntryYaml } from "../../core/entry-yaml.js";
import type { KV } from "../../core/kv.js";
import type { Systemd } from "../../core/systemd.js";

// ---------------------------------------------------------------------------
// CharactersStore: entry.yaml chars + systemd status + KV managed list.
// All systemctl execution and entry.yaml IO goes through the review-gated
// core capabilities (Systemd / EntryYaml) — never inline here.
// ---------------------------------------------------------------------------

export interface CharacterRow {
  account: string;
  char_name: string;
  game_code: string;
  managed: boolean;
  unit: string;
  active: boolean;
  sub: string;
  uptime: number | null;
}

export type ActionResult = { ok: boolean; error?: string; was_managed?: boolean };

const MANAGED_KEY = "characters:managed";

export class CharactersStore {
  constructor(
    private kv: KV,
    private yaml: EntryYaml,
    private systemd: Systemd,
  ) {}

  private yamlChars(): EntryChar[] {
    // Missing/corrupt entry.yaml degrades to an empty list (v1 try/catch behavior).
    try {
      return this.yaml.read();
    } catch {
      return [];
    }
  }

  private known(name: string): EntryChar | undefined {
    return this.yamlChars().find((c) => c.char_name.toLowerCase() === name.toLowerCase());
  }

  /** Seed the managed list from entry.yaml once at boot (v1 seeded its DB at boot). */
  async seedManagedIfEmpty(): Promise<void> {
    const existing = await this.kv.get(MANAGED_KEY);
    if (existing !== null) return;
    await this.kv.set(MANAGED_KEY, JSON.stringify(this.yamlChars().map((c) => c.char_name.toLowerCase())));
  }

  async managed(): Promise<string[]> {
    const raw = await this.kv.get(MANAGED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  }

  async setManaged(name: string, managed: boolean): Promise<void> {
    const list = await this.managed();
    const key = name.toLowerCase();
    if (managed) {
      if (!list.includes(key)) await this.kv.set(MANAGED_KEY, JSON.stringify([...list, key]));
    } else {
      await this.kv.set(MANAGED_KEY, JSON.stringify(list.filter((n) => n !== key)));
    }
  }

  /** All entry.yaml characters with live systemd status and managed flag. */
  async list(): Promise<CharacterRow[]> {
    const managedSet = new Set(await this.managed());
    return Promise.all(
      this.yamlChars().map(async (ch) => {
        const status = await this.systemd.show(ch.char_name);
        return {
          ...ch,
          managed: managedSet.has(ch.char_name.toLowerCase()),
          unit: this.systemd.unitFor(ch.char_name),
          ...status,
        };
      }),
    );
  }

  /** Single character row; null when the name is not a known entry.yaml char. */
  async get(name: string): Promise<CharacterRow | null> {
    const ch = this.known(name);
    if (!ch) return null;
    const managedSet = new Set(await this.managed());
    const status = await this.systemd.show(ch.char_name);
    return {
      ...ch,
      managed: managedSet.has(ch.char_name.toLowerCase()),
      unit: this.systemd.unitFor(ch.char_name),
      ...status,
    };
  }

  /** Start a headless Lich session; null when the char is unknown (route 404s). */
  async start(name: string): Promise<ActionResult | null> {
    const ch = this.known(name);
    if (!ch) return null;
    return this.systemd.action("start", ch.char_name);
  }

  /** Stop a session; unmanage (so the watchdog won't restart it) only when the stop succeeded. */
  async stop(name: string): Promise<ActionResult | null> {
    const ch = this.known(name);
    if (!ch) return null;
    const wasManaged = (await this.managed()).includes(ch.char_name.toLowerCase());
    const res = await this.systemd.action("stop", ch.char_name);
    if (res.ok && wasManaged) await this.setManaged(ch.char_name, false);
    return { ...res, was_managed: wasManaged };
  }

  /** Restart a headless Lich session; null when the char is unknown. */
  async restart(name: string): Promise<ActionResult | null> {
    const ch = this.known(name);
    if (!ch) return null;
    return this.systemd.action("restart", ch.char_name);
  }
}
