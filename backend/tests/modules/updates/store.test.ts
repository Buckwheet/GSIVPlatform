import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CoreDb } from "../../../src/core/db.js";
import type { UpstreamRelease } from "../../../src/modules/updates/github.js";
import { UpdatesStore } from "../../../src/modules/updates/store.js";

const rel = (tag: string, published_at: string | null = "2026-09-09T12:00:00Z"): UpstreamRelease => ({
  tag,
  url: `https://github.com/Nisugi/VellumFE/releases/tag/${tag}`,
  published_at,
});

/** Two upstream releases, newest first (as GitHub returns them). */
const RELEASES = [rel("v0.3.0-beta.50"), rel("v0.3.0-beta.44")];

describe("UpdatesStore", () => {
  let db: CoreDb;

  beforeEach(() => {
    db = new CoreDb(":memory:");
  });
  afterEach(() => {
    db.close();
  });

  const makeStore = (currentVersion?: string, iso = "2026-09-11T00:00:00.000Z") =>
    new UpdatesStore(db, { currentVersion, now: () => new Date(iso) });

  it("files nothing and reports not-current when the deployed version matches upstream", () => {
    const store = makeStore("0.3.0-beta.50");
    const res = store.applyReleases(RELEASES);
    expect(res).toEqual({ latest: "v0.3.0-beta.50", updateAvailable: false, filed: null });
    expect(store.status()).toEqual({
      current: "0.3.0-beta.50",
      latest: "v0.3.0-beta.50",
      updateAvailable: false,
      lastCheckedAt: "2026-09-11T00:00:00.000Z",
      lastError: null,
    });
    expect(store.listNotifications().unread).toBe(0);
  });

  it("files one unread notification when upstream is newer, then never re-files it", () => {
    const store = makeStore("0.3.0-beta.37");
    const first = store.applyReleases(RELEASES);
    expect(first.updateAvailable).toBe(true);
    expect(first.filed).toMatchObject({ tag: "v0.3.0-beta.50", acknowledged_at: null });
    expect(first.filed?.id).toBeGreaterThan(0);

    const second = store.applyReleases(RELEASES);
    expect(second.updateAvailable).toBe(true);
    expect(second.filed).toBeNull(); // dedup by tag
    expect(store.listNotifications()).toMatchObject({ total: 1, unread: 1 });
    const listed = store.listNotifications();
    expect(listed.status.updateAvailable).toBe(true);
    expect(listed.notifications[0]).toMatchObject({ tag: "v0.3.0-beta.50", url: rel("v0.3.0-beta.50").url });
  });

  it("stays unread until acked, then reports zero unread", () => {
    const store = makeStore("0.3.0-beta.37");
    store.applyReleases(RELEASES);
    expect(store.listNotifications().unread).toBe(1);
    expect(store.ack()).toBe(1);
    expect(store.listNotifications()).toMatchObject({ total: 1, unread: 0 });
    expect(store.listNotifications().notifications[0].acknowledged_at).toBe("2026-09-11T00:00:00.000Z");
    expect(store.ack()).toBe(0); // nothing left unread
  });

  it("acks only the given ids", () => {
    const store = makeStore("0.2.0");
    store.applyReleases([rel("v0.3.0-beta.50")], "2026-09-11T00:00:00.000Z");
    store.applyReleases([rel("v0.3.1")], "2026-09-12T00:00:00.000Z");
    const ids = store.listNotifications().notifications.map((n) => n.id);
    expect(ids).toHaveLength(2);
    expect(store.ack([ids[0]])).toBe(1);
    expect(store.listNotifications().unread).toBe(1);
  });

  it("files nothing (and claims no update) when VELLUM_VERSION is unset", () => {
    const store = makeStore(undefined);
    const res = store.applyReleases(RELEASES);
    expect(res).toEqual({ latest: "v0.3.0-beta.50", updateAvailable: false, filed: null });
    expect(store.status()).toMatchObject({ current: null, latest: "v0.3.0-beta.50", updateAvailable: false });
  });

  it("records an empty upstream list without filing anything", () => {
    const store = makeStore("0.3.0-beta.37");
    expect(store.applyReleases([])).toEqual({ latest: null, updateAvailable: false, filed: null });
    expect(store.listNotifications().unread).toBe(0);
  });

  describe("poll", () => {
    const okFetch = async () => ({ ok: true, status: 200, json: async () => [{ tag_name: "v0.3.0-beta.50" }] });

    it("fetches and applies, leaving lastError clear", async () => {
      const store = makeStore("0.3.0-beta.37");
      const res = await store.poll({ fetch: okFetch, repo: "Nisugi/VellumFE" });
      expect(res).toMatchObject({ latest: "v0.3.0-beta.50", updateAvailable: true });
      expect(store.status().lastError).toBeNull();
    });

    it("records a failed poll instead of throwing", async () => {
      const store = makeStore("0.3.0-beta.37");
      const boom = async () => ({ ok: false, status: 502, json: async () => ({}) });
      const res = await store.poll({ fetch: boom, repo: "Nisugi/VellumFE" });
      expect(res.filed).toBeNull();
      expect(store.status().lastError).toBe("GitHub releases HTTP 502");
      expect(store.status().lastCheckedAt).toBe("2026-09-11T00:00:00.000Z");
    });

    it("keeps a stale lastError-free result when a later poll succeeds", async () => {
      const store = makeStore("0.3.0-beta.37");
      await store.poll({ fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }), repo: "r" });
      expect(store.status().lastError).toBe("GitHub releases HTTP 500");
      await store.poll({ fetch: okFetch, repo: "Nisugi/VellumFE" });
      expect(store.status().lastError).toBeNull();
      expect(store.listNotifications().unread).toBe(1);
    });
  });
});
