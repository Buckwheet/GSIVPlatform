import { describe, expect, it } from "vitest";
import {
  parseExecStartArgv,
  parseStreams,
  StreamProvisioner,
  serializeStreams,
} from "../../src/core/stream-provision.js";

const LICH_TEMPLATE =
  "ExecStart={ path=/usr/bin/xvfb-run ; argv[]=/usr/bin/xvfb-run -a " +
  "/home/ubuntu/.rbenv/versions/4.0.6/bin/ruby lich.rbw --login {CHAR} --without-frontend " +
  "--scripts=/opt/gs4sd/lich5/scripts --reconnect --start-scripts=gs4sd_publisher,accept,log,gs4sd_premium ; ignore_errors=no }";

const VELLUM_TEMPLATE =
  "ExecStart={ path=/opt/vellumfe/vellum-fe ; argv[]=/opt/vellumfe/vellum-fe " +
  "--frontend headless --host 127.0.0.1 --port 9101 --web-port 9201 --web-bind 127.0.0.1 --nosound --character {CHAR} ; ignore_errors=no }";

function lichShow(char: string, detach?: number): string {
  const base = LICH_TEMPLATE.replaceAll("{CHAR}", char);
  if (detach !== undefined) {
    return base.replace(
      "--reconnect --start-scripts=gs4sd_publisher,accept,log,gs4sd_premium",
      `--reconnect --detachable-client=${detach} --start-scripts=gs4sd_publisher,accept,log,gs4sd_premium`,
    );
  }
  return base;
}

interface Mem {
  files: Record<string, string>;
  logs: string[];
  activeUnits: Set<string>;
  caddyValidateOk: boolean;
}

function makeProvisioner(
  mem: Mem,
  opts?: {
    streamDomain?: string;
    baseUrl?: string;
    token?: string;
    currentStreams?: Record<string, { detach: number; web: number }>;
    active?: (unit: string) => boolean;
  },
) {
  const streams: Record<string, { detach: number; web: number }> = opts?.currentStreams ?? {
    Fisternar: { detach: 9101, web: 9201 },
    Neleourg: { detach: 9102, web: 9202 },
  };

  const exec = async (cmd: string, args: string[], _t: number) => {
    mem.logs.push([cmd, ...args].join(" "));
    // Resolve template units to argv for any char.
    if (cmd === "systemctl" && args[0] === "show" && args[1]?.startsWith("gs4sd-lich@")) {
      const char = args[1].slice("gs4sd-lich@".length, -".service".length);
      const existing = streams[char];
      return {
        stdout: lichShow(char, existing ? existing.detach : undefined),
        stderr: "",
        code: 0,
      };
    }
    if (cmd === "systemctl" && args[0] === "show" && args[1]?.startsWith("vellum-fe@")) {
      const char = args[1].slice("vellum-fe@".length, -".service".length);
      return { stdout: VELLUM_TEMPLATE.replaceAll("{CHAR}", char), stderr: "", code: 0 };
    }
    if (cmd === "systemctl" && args[0] === "is-active") {
      const active = opts?.active ? opts.active(args[1]) : mem.activeUnits.has(args[1]);
      return { stdout: active ? "active" : "inactive", stderr: "", code: active ? 0 : 3 };
    }
    if (cmd === "caddy" && args[0] === "validate") {
      if (!mem.caddyValidateOk) return { stdout: "", stderr: "invalid caddy", code: 1 };
      return { stdout: "Valid configuration", stderr: "", code: 0 };
    }
    // all other systemctl/caddy actions succeed
    return { stdout: "", stderr: "", code: 0 };
  };

  const write = (path: string, content: string) => {
    mem.logs.push(`write ${path}`);
    mem.files[path] = content;
  };
  const read = (path: string): string => {
    if (!(path in mem.files)) throw new Error(`no file ${path}`);
    return mem.files[path];
  };

  return new StreamProvisioner({
    paths: {
      systemdDir: "/etc/systemd/system",
      caddyfile: "/etc/caddy/Caddyfile",
      envPath: "/opt/gsiv-platform/backend/.env",
    },
    streamDomain: opts?.streamDomain ?? "phylactery.ovh",
    baseUrl: opts?.baseUrl ?? "https://vellum.phylactery.ovh",
    token: opts?.token ?? "tok",
    currentStreams: () => streams,
    allocator: undefined,
    exec,
    write,
    read,
    exists: (p: string) => p in mem.files,
    remove: (paths: string[]) => {
      for (const p of paths) delete mem.files[p];
    },
    timeoutMs: 100,
  });
}

function defaultMem(): Mem {
  return {
    files: {
      "/etc/caddy/Caddyfile": [
        ":80 {",
        "\t@dashboard host dashboard.phylactery.ovh",
        "\thandle @dashboard {",
        "\t\tredir https://gsiv.phylactery.ovh{uri} permanent",
        "\t}",
        "}",
      ].join("\n"),
      "/opt/gsiv-platform/backend/.env":
        "VELLUM_BASE_URL=https://vellum.phylactery.ovh\nVELLUM_STREAMS=Fisternar:9101:9201,Neleourg:9102:9202\nAUTH_TOKENS=x\n",
    },
    logs: [],
    activeUnits: new Set(),
    caddyValidateOk: true,
  };
}

describe("parseStreams / serializeStreams", () => {
  it("round-trips the streams grammar", () => {
    const m = parseStreams("Fisternar:9101:9201,Neleourg:9102:9202");
    expect(m).toEqual({
      Fisternar: { detach: 9101, web: 9201 },
      Neleourg: { detach: 9102, web: 9202 },
    });
    expect(serializeStreams(m)).toBe("Fisternar:9101:9201,Neleourg:9102:9202");
  });
  it("skips malformed entries", () => {
    expect(parseStreams("Fisternar:9101:9201,;garbage,,Foo:nan:9200")).toEqual({
      Fisternar: { detach: 9101, web: 9201 },
    });
  });
});

describe("parseExecStartArgv", () => {
  it("extracts argv tokens from a systemctl show line", () => {
    const argv = parseExecStartArgv(LICH_TEMPLATE.replaceAll("{CHAR}", "Vaikar"));
    expect(argv).toContain("--login");
    expect(argv).toContain("Vaikar");
    expect(argv).toContain("--start-scripts=gs4sd_publisher,accept,log,gs4sd_premium");
  });
  it("returns null when argv marker is absent", () => {
    expect(parseExecStartArgv("ExecStart={ path=/x }")).toBeNull();
  });
});

describe("StreamProvisioner.provision", () => {
  it("provisions an unprovisioned char, returns URL, and extends caddy + env", async () => {
    const mem = defaultMem();
    mem.activeUnits.add("gs4sd-lich@Buckwheet.service"); // char already running
    const p = makeProvisioner(mem);
    const res = await p.provision("Buckwheet");
    expect(res.provisioned).toBe(true);
    expect(res.char).toBe("Buckwheet");
    // Next-free: 9103/9203 (9101/9102 + 9201/9202 used)
    expect(res.ports).toEqual({ detach: 9103, web: 9203 });
    expect(res.url).toBe("https://buckwheet.phylactery.ovh/play#token=tok&lich=127.0.0.1:9103&name=Buckwheet");

    // Lich drop-in added --detachable-client, kept start-scripts
    const lichDropin = mem.files["/etc/systemd/system/gs4sd-lich@Buckwheet.service.d/override.conf"];
    expect(lichDropin).toContain("ExecStart=/usr/bin/xvfb-run -a");
    expect(lichDropin).toContain("--login Buckwheet");
    expect(lichDropin).toContain("--start-scripts=gs4sd_publisher,accept,log,gs4sd_premium");
    expect(lichDropin).toContain("--detachable-client=9103");

    // vellum drop-in ports
    const vellDropin = mem.files["/etc/systemd/system/vellum-fe@Buckwheet.service.d/override.conf"];
    expect(vellDropin).toContain("--port 9103 --web-port 9203");
    expect(vellDropin).toContain("--character Buckwheet");

    // Caddy gained matcher + handler
    const caddy = mem.files["/etc/caddy/Caddyfile"];
    expect(caddy).toContain("@buckwheet host buckwheet.phylactery.ovh");
    expect(caddy).toContain("reverse_proxy 127.0.0.1:9203");
    // The new handler must be a top-level SIBLING of the other @v… handlers
    // (1 tab indentation), never nested inside a prior handler's block — a
    // nesting bug was observed with a hand-edited Caddyfile and caused the
    // stream page to serve an empty body.
    const handleLine = caddy.split("\n").find((l) => l.trim() === "handle @buckwheet {");
    expect(handleLine?.startsWith("\t") && handleLine?.indexOf("handle") === 1).toBe(true);
    expect(handleLine?.startsWith("\t") && handleLine?.indexOf("handle") === 1).toBe(true);
    // Balanced braces overall.
    let balance = 0;
    for (const ch of caddy.replaceAll("\t", "")) {
      if (ch === "{") balance++;
      else if (ch === "}") balance--;
    }
    expect(balance).toBe(0);

    // .env gained entry; other keys preserved
    const env = mem.files["/opt/gsiv-platform/backend/.env"];
    expect(env).toContain("VELLUM_STREAMS=Fisternar:9101:9201,Neleourg:9102:9202,Buckwheet:9103:9203");
    expect(env).toContain("AUTH_TOKENS=x");

    // systemd flow executed
    expect(mem.logs).toContain("systemctl daemon-reload");
    expect(mem.logs).toContain("systemctl enable --now vellum-fe@Buckwheet.service");
    expect(mem.logs).toContain("systemctl restart gs4sd-lich@Buckwheet.service");
    expect(mem.logs).toContain("caddy validate --config /etc/caddy/Caddyfile");
    expect(mem.logs).toContain("caddy reload --config /etc/caddy/Caddyfile");
  });

  it("provisioning a char that is not running does NOT restart its Lich unit", async () => {
    const mem = defaultMem();
    const p = makeProvisioner(mem);
    const res = await p.provision("Buckwheet");
    expect(res.provisioned).toBe(true);
    expect(mem.logs.some((l) => l.startsWith("systemctl restart gs4sd-lich@Buckwheet"))).toBe(false);
  });

  it("is a no-op for an already-provisioned char (returns existing, no writes)", async () => {
    const mem = defaultMem();
    const p = makeProvisioner(mem);
    const res = await p.provision("Fisternar");
    expect(res.provisioned).toBe(false);
    expect(res.ports).toEqual({ detach: 9101, web: 9201 });
    expect(mem.logs).toEqual([]); // no exec at all
  });

  it("rolls back all mutations when the Caddy config is invalid", async () => {
    const mem = defaultMem();
    mem.caddyValidateOk = false;
    const caddyBefore = mem.files["/etc/caddy/Caddyfile"];
    const envBefore = mem.files["/opt/gsiv-platform/backend/.env"];
    const p = makeProvisioner(mem);
    await expect(p.provision("Buckwheet")).rejects.toThrow(/invalid new Caddy config/);

    // Caddyfile + .env restored to pre-provision content
    expect(mem.files["/etc/caddy/Caddyfile"]).toBe(caddyBefore);
    expect(mem.files["/opt/gsiv-platform/backend/.env"]).toBe(envBefore);
    // Drop-ins removed + unit stopped/disabled
    expect(mem.files["/etc/systemd/system/gs4sd-lich@Buckwheet.service.d/override.conf"]).toBeUndefined();
    expect(mem.files["/etc/systemd/system/vellum-fe@Buckwheet.service.d/override.conf"]).toBeUndefined();
    expect(mem.logs).toContain("systemctl daemon-reload");
    expect(mem.logs).toContain("systemctl stop vellum-fe@Buckwheet.service");
    expect(mem.logs).toContain("systemctl disable vellum-fe@Buckwheet.service");
  });

  it("validates the character name and rejects bad names", async () => {
    const mem = defaultMem();
    const p = makeProvisioner(mem);
    await expect(p.provision("../evil")).rejects.toThrow(/invalid character name/);
    expect(mem.logs).toEqual([]);
  });
});
