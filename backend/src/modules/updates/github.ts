/**
 * Minimal GitHub *releases* reader for the version check.
 *
 * Upstream marks every VellumFE release as Pre-release, so `/releases/latest`
 * never resolves — we list releases and pick the max ourselves (semver.ts).
 * The `fetch` implementation is injected so tests never touch the network.
 */
import { compareVersions, parseVersion } from "./semver.js";

export interface UpstreamRelease {
  tag: string;
  url: string;
  published_at: string | null;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Injected fetch: tests pass a stub, the poller passes `globalThis.fetch`. */
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponse>;

export function releasesUrl(repo: string): string {
  return `https://api.github.com/repos/${repo}/releases?per_page=30`;
}

/** Drop drafts and anything that isn't a parseable version tag. */
export function normalizeReleases(payload: unknown, repo: string): UpstreamRelease[] {
  if (!Array.isArray(payload)) throw new Error("unexpected GitHub releases payload (expected an array)");
  const out: UpstreamRelease[] = [];
  for (const raw of payload) {
    const r = raw as { tag_name?: unknown; html_url?: unknown; published_at?: unknown; draft?: unknown };
    if (r?.draft === true) continue;
    const tag = typeof r?.tag_name === "string" ? r.tag_name.trim() : "";
    if (!tag) continue;
    try {
      parseVersion(tag);
    } catch {
      continue; // non-semver tag: not a release we can compare
    }
    out.push({
      tag,
      url: typeof r?.html_url === "string" ? r.html_url : `https://github.com/${repo}/releases/tag/${tag}`,
      published_at: typeof r?.published_at === "string" ? r.published_at : null,
    });
  }
  return out;
}

export function pickLatestRelease(releases: UpstreamRelease[]): UpstreamRelease | null {
  let best: UpstreamRelease | null = null;
  for (const r of releases) {
    if (!best || compareVersions(r.tag, best.tag) > 0) best = r;
  }
  return best;
}

export async function fetchReleases(fetchImpl: FetchLike, repo: string, token?: string): Promise<UpstreamRelease[]> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "gsiv-platform-updates",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(releasesUrl(repo), { headers });
  if (!res.ok) throw new Error(`GitHub releases HTTP ${res.status}`);
  return normalizeReleases(await res.json(), repo);
}
