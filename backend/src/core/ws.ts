export class EventBus {
  private subs = new Map<string, Map<string, Set<(p: unknown) => void>>>();

  on(module: string, type: string, handler: (payload: unknown) => void): () => void {
    let byType = this.subs.get(module);
    if (!byType) {
      byType = new Map();
      this.subs.set(module, byType);
    }
    let handlers = byType.get(type);
    if (!handlers) {
      handlers = new Set();
      byType.set(type, handlers);
    }
    if (handlers.size > 0) throw new Error(`subscription already exists: ${module}.${type}`);
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  emit(type: string, payload: unknown): void {
    for (const byType of this.subs.values()) {
      const handlers = byType.get(type);
      if (!handlers) continue;
      for (const h of [...handlers]) h(payload);
    }
  }
}
