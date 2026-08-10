import type { Module } from "./types.js";

export class RegistryError extends Error {}

export class Registry {
  private modules = new Map<string, Module>();

  register(m: Module): void {
    if (this.modules.has(m.name)) {
      throw new RegistryError(`duplicate module name: ${m.name}`);
    }
    for (const existing of this.modules.values()) {
      if (existing.prefix === m.prefix) {
        throw new RegistryError(`duplicate prefix: ${m.prefix} (${m.name} vs ${existing.name})`);
      }
    }
    this.modules.set(m.name, m);
  }

  get(name: string): Module | undefined {
    return this.modules.get(name);
  }

  list(): Module[] {
    return [...this.modules.values()];
  }

  /** Fail-fast boot validation. Throws RegistryError with all violations. */
  validate(): void {
    const errors: string[] = [];
    for (const m of this.modules.values()) {
      const declared = new Set(m.scopes.map((s) => s.name));
      const used = new Set(Object.values(m.routeScopes).flat());
      for (const name of declared) {
        if (!used.has(name)) errors.push(`${m.name}: declared scope '${name}' is never used`);
      }
      for (const [key] of Object.entries(m.routeScopes)) {
        if (!/^(GET|POST|PUT|PATCH|DELETE) \//.test(key)) {
          errors.push(`${m.name}: invalid route scope key '${key}'`);
        }
      }
    }
    if (errors.length) throw new RegistryError(errors.join("; "));
  }
}
