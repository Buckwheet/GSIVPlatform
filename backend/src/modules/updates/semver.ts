/**
 * Beta-aware semver comparison for upstream release tags.
 *
 * Upstream tags look like `v0.3.0-beta.44`. Neither lexical nor numeric
 * comparison works there (`beta.44` sorts after `beta.50` as a string, and
 * `Number("0.3.0-beta.44")` is `NaN`), so this implements the semver 2.0.0
 * precedence rules for the shape upstream actually publishes. A missing
 * minor/patch defaults to 0 (`v1` == `1.0.0`); a release outranks its own
 * prereleases (`0.3.0 > 0.3.0-beta.50`).
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers; empty for a final release. */
  prerelease: string[];
}

export class VersionParseError extends Error {}

export function parseVersion(input: string): ParsedVersion {
  const raw = input.trim().replace(/^v/i, "").split("+")[0]; // drop build metadata
  if (!raw) throw new VersionParseError(`empty version: ${JSON.stringify(input)}`);
  const [core, ...rest] = raw.split("-");
  const nums = core.split(".");
  if (nums.length === 0 || nums.length > 3 || nums.some((n) => !/^\d+$/.test(n))) {
    throw new VersionParseError(`unparseable version: ${JSON.stringify(input)}`);
  }
  const [major, minor = "0", patch = "0"] = nums;
  const pre = rest.join("-");
  const prerelease = pre === "" ? [] : pre.split(".");
  if (prerelease.some((id) => id === "" || !/^[0-9A-Za-z-]+$/.test(id))) {
    throw new VersionParseError(`unparseable prerelease: ${JSON.stringify(input)}`);
  }
  return { major: Number(major), minor: Number(minor), patch: Number(patch), prerelease };
}

/** -1, 0, 1 for a < b, a == b, a > b. Throws VersionParseError on garbage. */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (const key of ["major", "minor", "patch"] as const) {
    if (va[key] !== vb[key]) return va[key] < vb[key] ? -1 : 1;
  }
  if (va.prerelease.length === 0 || vb.prerelease.length === 0) {
    if (va.prerelease.length === vb.prerelease.length) return 0;
    return va.prerelease.length === 0 ? 1 : -1; // final release outranks a prerelease
  }
  const len = Math.max(va.prerelease.length, vb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const x = va.prerelease[i];
    const y = vb.prerelease[i];
    if (x === undefined) return -1; // fewer identifiers = lower precedence
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      if (x !== y) return Number(x) < Number(y) ? -1 : 1;
      continue;
    }
    if (xNum !== yNum) return xNum ? -1 : 1; // numeric identifiers sort below alphanumeric
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** True when `candidate` is a strictly newer version than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
