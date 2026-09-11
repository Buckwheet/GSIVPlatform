import { describe, expect, it } from "vitest";
import {
  fetchReleases,
  normalizeReleases,
  pickLatestRelease,
  releasesUrl,
} from "../../../src/modules/updates/github.js";

const ghRelease = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/Nisugi/VellumFE/releases/tag/${tag}`,
  published_at: "2026-09-09T12:00:00Z",
  draft: false,
  prerelease: true,
  ...extra,
});

describe("normalizeReleases", () => {
  it("keeps semver tags, drops drafts and non-version tags", () => {
    const out = normalizeReleases(
      [
        ghRelease("v0.3.0-beta.50"),
        ghRelease("v0.3.1-draft", { draft: true }),
        ghRelease("nightly"),
        ghRelease("v0.3.0-beta.51", { html_url: undefined, published_at: undefined }),
        { junk: true },
      ],
      "Nisugi/VellumFE",
    );
    expect(out.map((r) => r.tag)).toEqual(["v0.3.0-beta.50", "v0.3.0-beta.51"]);
    expect(out[1].url).toBe("https://github.com/Nisugi/VellumFE/releases/tag/v0.3.0-beta.51");
    expect(out[1].published_at).toBeNull();
  });

  it("rejects a non-array payload", () => {
    expect(() => normalizeReleases({ message: "Not Found" }, "Nisugi/VellumFE")).toThrow(/expected an array/);
  });
});

describe("pickLatestRelease", () => {
  it("picks the numerically-highest beta, not the lexically-last tag", () => {
    const releases = ["v0.3.0-beta.9", "v0.3.0-beta.50", "v0.3.0-beta.44"].map((t) => ({
      tag: t,
      url: "",
      published_at: null,
    }));
    expect(pickLatestRelease(releases)?.tag).toBe("v0.3.0-beta.50");
  });

  it("returns null for an empty list", () => {
    expect(pickLatestRelease([])).toBeNull();
  });
});

describe("fetchReleases", () => {
  it("sends a GitHub accept header and returns parsed releases", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> | undefined;
    const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
      seenUrl = url;
      seenHeaders = init?.headers;
      return { ok: true, status: 200, json: async () => [ghRelease("v0.3.0-beta.50")] };
    };
    const out = await fetchReleases(fetchImpl, "Nisugi/VellumFE");
    expect(seenUrl).toBe(releasesUrl("Nisugi/VellumFE"));
    expect(seenHeaders?.accept).toBe("application/vnd.github+json");
    expect(seenHeaders?.authorization).toBeUndefined();
    expect(out).toHaveLength(1);
  });

  it("adds a bearer token when configured", async () => {
    let seenHeaders: Record<string, string> | undefined;
    const fetchImpl = async (_url: string, init?: { headers?: Record<string, string> }) => {
      seenHeaders = init?.headers;
      return { ok: true, status: 200, json: async () => [] };
    };
    await fetchReleases(fetchImpl, "Nisugi/VellumFE", "ghp_secret");
    expect(seenHeaders?.authorization).toBe("Bearer ghp_secret");
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
    await expect(fetchReleases(fetchImpl, "Nisugi/VellumFE")).rejects.toThrow(/HTTP 403/);
  });
});
