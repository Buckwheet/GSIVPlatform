/**
 * Poll timer for the upstream release check.
 *
 * In-process (not a systemd timer) because the check is read-only outbound HTTP
 * with no host mutation, and this way a restart of `gsiv-platform` — which a
 * `VELLUM_VERSION` change requires anyway — starts the watch with no extra unit
 * to install. The timer is `unref()`d so it never keeps the process alive.
 */
import type { FetchLike } from "./github.js";
import type { UpdatesStore } from "./store.js";

/** 6 hours: upstream releases are rare, and GitHub's anonymous API is rate-limited. */
export const DEFAULT_POLL_MS = 6 * 60 * 60 * 1000;

export interface UpdatesPollerOptions {
  repo: string;
  token?: string;
  intervalMs?: number;
  fetchImpl?: FetchLike;
  log?: (message: string) => void;
}

/** Starts an immediate check plus a repeating one. Returns a stop function. */
export function startUpdatesPoller(store: UpdatesStore, opts: UpdatesPollerOptions): () => void {
  const intervalMs =
    Number.isFinite(opts.intervalMs) && (opts.intervalMs as number) > 0 ? (opts.intervalMs as number) : DEFAULT_POLL_MS;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const log = opts.log ?? ((message: string) => console.log(message));

  const tick = async (): Promise<void> => {
    const res = await store.poll({ fetch: fetchImpl, repo: opts.repo, token: opts.token });
    const status = store.status();
    if (status.lastError) {
      log(`updates: check failed: ${status.lastError}`);
      return;
    }
    log(
      `updates: latest=${status.latest ?? "none"} deployed=${status.current ?? "unset"}${
        res.filed ? ` — filed ${res.filed.tag}` : ""
      }`,
    );
  };

  void tick(); // don't leave the bell blind until the first interval elapses
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
