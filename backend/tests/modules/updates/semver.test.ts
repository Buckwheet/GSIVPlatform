import { describe, expect, it } from "vitest";
import { compareVersions, isNewer, parseVersion, VersionParseError } from "../../../src/modules/updates/semver.js";

describe("parseVersion", () => {
  it("parses a beta tag and strips the leading v", () => {
    expect(parseVersion("v0.3.0-beta.50")).toEqual({ major: 0, minor: 3, patch: 0, prerelease: ["beta", "50"] });
  });

  it("defaults missing minor/patch and drops build metadata", () => {
    expect(parseVersion("1")).toEqual({ major: 1, minor: 0, patch: 0, prerelease: [] });
    expect(parseVersion("1.2+build.7")).toEqual({ major: 1, minor: 2, patch: 0, prerelease: [] });
  });

  it("rejects garbage", () => {
    expect(() => parseVersion("")).toThrow(VersionParseError);
    expect(() => parseVersion("latest")).toThrow(VersionParseError);
    expect(() => parseVersion("1.2.3.4")).toThrow(VersionParseError);
  });
});

describe("compareVersions", () => {
  it("orders beta numbers numerically, not lexically", () => {
    expect(compareVersions("0.3.0-beta.44", "0.3.0-beta.50")).toBe(-1);
    expect(compareVersions("v0.3.0-beta.50", "0.3.0-beta.44")).toBe(1);
    expect(compareVersions("0.3.0-beta.9", "0.3.0-beta.10")).toBe(-1);
  });

  it("treats a final release as newer than any prerelease of the same core", () => {
    expect(compareVersions("0.3.0", "0.3.0-beta.50")).toBe(1);
    expect(compareVersions("0.3.0-beta.50", "0.3.0")).toBe(-1);
  });

  it("compares the core version first", () => {
    expect(compareVersions("0.3.0-beta.50", "0.4.0-beta.1")).toBe(-1);
    expect(compareVersions("0.3.1", "0.3.0")).toBe(1);
    expect(compareVersions("0.4", "0.4.0")).toBe(0);
  });

  it("ignores the v prefix and build metadata", () => {
    expect(compareVersions("v0.3.0", "0.3.0")).toBe(0);
    expect(compareVersions("0.3.0+abc", "v0.3.0")).toBe(0);
  });

  it("ranks a prerelease with extra identifiers higher", () => {
    expect(compareVersions("0.3.0-beta", "0.3.0-beta.1")).toBe(-1);
    expect(compareVersions("0.3.0-alpha", "0.3.0-beta")).toBe(-1);
  });
});

describe("isNewer", () => {
  it("is false when the deployed version is current", () => {
    expect(isNewer("0.3.0-beta.50", "0.3.0-beta.50")).toBe(false);
    expect(isNewer("0.3.0-beta.37", "0.3.0-beta.50")).toBe(false);
    expect(isNewer("0.3.0-beta.50", "0.3.0-beta.37")).toBe(true);
  });
});
