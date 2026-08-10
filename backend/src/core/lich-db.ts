import { execFile } from "node:child_process";
import { validateCharName } from "./systemd.js";

// ---------------------------------------------------------------------------
// Review-gated core capability: the ONLY place in the platform that runs Ruby
// against the Lich sqlite db (go2 / eherbs script settings). Fixed Ruby
// templates; scope and settings are passed via ARGV — never interpolated into
// Ruby source (v1 interpolated the scope: an injection risk). Injectable exec.
// ---------------------------------------------------------------------------

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export type ExecFn = (cmd: string, args: string[], timeoutMs: number) => Promise<ExecResult>;

export type Instance = "GSIV" | "GST" | "GS3";

const TIMEOUT_MS = 10_000;
const INSTANCE_RE = /^(GSIV|GST|GS3)$/;
const DEFAULT_DB_PATH = process.env.LICH_DB_PATH || "/opt/gs4sd/lich5/data/lich.db3";

const GO2_GET_SCRIPT = `
require 'sqlite3'
require 'json'
scope = ARGV[0]
db_path = ARGV[1]
db = SQLite3::Database.new(db_path)
uv_blob = db.get_first_value("SELECT hash FROM uservars WHERE scope = ?", scope)
cs_blob = db.get_first_value("SELECT hash FROM script_auto_settings WHERE script = 'go2' AND scope = ?", scope)
uv = uv_blob ? Marshal.load(uv_blob) : {}
cs = cs_blob ? Marshal.load(cs_blob) : {}
out = {}
%w[mapdb_car_to_sos mapdb_car_from_sos mapdb_use_portals mapdb_use_old_portals mapdb_use_urchins mapdb_use_portmasters mapdb_use_day_pass mapdb_buy_day_pass mapdb_ice_mode mapdb_fwi_trinket rogue_password mapdb_hinterwilds_location].each{|k| out[k] = uv[k]}
portals = out['mapdb_use_portals']
out['mapdb_use_portals'] = (portals == 'yes' ? true : (portals == 'no' ? false : portals))
out['day_pass_sack'] = uv['day_pass_sack']
%w[delay typeahead].each{|k| out[k] = cs[k]}
out['stop_for_dead'] = cs['stop for dead']
out['get_silvers'] = cs['get silvers']
out['get_return_silvers'] = cs['get return trip silvers']
out['vaalor_shortcut'] = cs['vaalor shortcut']
out['use_seeking'] = cs['use seeking']
out['echo_input'] = cs['echo_input']
out['hide_room_descriptions'] = cs['hide_room_descriptions']
out['hide_room_titles'] = cs['hide_room_titles']
out['use_gigas_hwtravel'] = cs['use_gigas_hwtravel']
out['gigas_min_number'] = cs['gigas_min_number']
print JSON.generate(out)
`;

const GO2_PUT_SCRIPT = `
require 'sqlite3'
require 'json'
scope = ARGV[0]
db_path = ARGV[1]
s = JSON.parse(ARGV[2])
db = SQLite3::Database.new(db_path)
uv_blob = db.get_first_value("SELECT hash FROM uservars WHERE scope = ?", scope)
cs_blob = db.get_first_value("SELECT hash FROM script_auto_settings WHERE script = 'go2' AND scope = ?", scope)
uv = uv_blob ? Marshal.load(uv_blob) : {}
cs = cs_blob ? Marshal.load(cs_blob) : {}
%w[mapdb_car_to_sos mapdb_car_from_sos mapdb_use_old_portals mapdb_use_urchins mapdb_use_portmasters mapdb_use_day_pass mapdb_ice_mode mapdb_fwi_trinket rogue_password mapdb_hinterwilds_location].each{|k| uv[k] = s[k] if s.key?(k)}
uv['day_pass_sack'] = s['day_pass_sack'] if s.key?('day_pass_sack')
uv['mapdb_use_portals'] = s['mapdb_use_portals'] == true ? 'yes' : 'no' if s.key?('mapdb_use_portals')
if s.key?('mapdb_buy_day_pass')
  v = s['mapdb_buy_day_pass']
  uv['mapdb_buy_day_pass'] = (v.nil? || v == '' || v =~ /off|no|false/i) ? nil : (v =~ /on|true|yes/i ? true : v)
end
%w[delay typeahead].each{|k| cs[k] = s[k].to_i if s.key?(k)}
cs['stop for dead'] = s['stop_for_dead'] if s.key?('stop_for_dead')
cs['get silvers'] = s['get_silvers'] if s.key?('get_silvers')
cs['get return trip silvers'] = s['get_return_silvers'] if s.key?('get_return_silvers')
cs['vaalor shortcut'] = s['vaalor_shortcut'] if s.key?('vaalor_shortcut')
cs['use seeking'] = s['use_seeking'] if s.key?('use_seeking')
cs['echo_input'] = s['echo_input'] if s.key?('echo_input')
cs['hide_room_descriptions'] = s['hide_room_descriptions'] if s.key?('hide_room_descriptions')
cs['hide_room_titles'] = s['hide_room_titles'] if s.key?('hide_room_titles')
cs['use_gigas_hwtravel'] = s['use_gigas_hwtravel'] if s.key?('use_gigas_hwtravel')
cs['gigas_min_number'] = s['gigas_min_number'].to_i if s.key?('gigas_min_number')
uv_out = Marshal.dump(uv)
cs_out = Marshal.dump(cs)
if uv_blob
  db.execute("UPDATE uservars SET hash = ? WHERE scope = ?", [SQLite3::Blob.new(uv_out), scope])
else
  db.execute("INSERT INTO uservars (scope, hash) VALUES (?, ?)", [scope, SQLite3::Blob.new(uv_out)])
end
if cs_blob
  db.execute("UPDATE script_auto_settings SET hash = ? WHERE script = 'go2' AND scope = ?", [SQLite3::Blob.new(cs_out), scope])
else
  db.execute("INSERT INTO script_auto_settings (script, scope, hash) VALUES ('go2', ?, ?)", [scope, SQLite3::Blob.new(cs_out)])
end
print '{"ok":true}'
`;

const EHERBS_GET_SCRIPT = `
require 'sqlite3'
require 'json'
scope = ARGV[0]
db_path = ARGV[1]
db = SQLite3::Database.new(db_path)
cs_blob = db.get_first_value("SELECT hash FROM script_auto_settings WHERE script = 'eherbs' AND scope = ?", scope)
cs = cs_blob ? Marshal.load(cs_blob) : {}
print JSON.generate(cs)
`;

const EHERBS_PUT_SCRIPT = `
require 'sqlite3'
require 'json'
scope = ARGV[0]
db_path = ARGV[1]
s = JSON.parse(ARGV[2])
db = SQLite3::Database.new(db_path)
cs_blob = db.get_first_value("SELECT hash FROM script_auto_settings WHERE script = 'eherbs' AND scope = ?", scope)
cs = cs_blob ? Marshal.load(cs_blob) : {}
%w[buy_missing deposit_coins use_mending skip_scars blood_toggle use650 use1035 use_yaba use_potions debug distiller].each{|k| cs[k] = s[k] if s.key?(k)}
cs['stock'] = s['stock'].to_i if s.key?('stock')
cs['herb_container'] = s['herb_container'] if s.key?('herb_container')
cs_out = Marshal.dump(cs)
if cs_blob
  db.execute("UPDATE script_auto_settings SET hash = ? WHERE script = 'eherbs' AND scope = ?", [SQLite3::Blob.new(cs_out), scope])
else
  db.execute("INSERT INTO script_auto_settings (script, scope, hash) VALUES ('eherbs', ?, ?)", [scope, SQLite3::Blob.new(cs_out)])
end
print '{"ok":true}'
`;

function defaultExec(cmd: string, args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        const code = typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : null;
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code });
      } else {
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code: 0 });
      }
    });
  });
}

type Result<T> = ({ ok: true } & T) | { ok: false; code: "invalid_input" | "exec" | "parse"; error: string };

type WriteResult = { ok: true } | { ok: false; code: "invalid_input" | "exec"; error: string };

export class LichDb {
  constructor(
    private exec: ExecFn = defaultExec,
    private opts: { dbPath?: string } = {},
  ) {}

  get dbPath(): string {
    return this.opts.dbPath ?? DEFAULT_DB_PATH;
  }

  /** Validate char + instance and derive the Lich scope (`{INSTANCE}:{Name}`). */
  private scopeFor(char: string, instance: string): string | null {
    try {
      validateCharName(char);
    } catch {
      return null;
    }
    const inst = instance.toUpperCase();
    if (!INSTANCE_RE.test(inst)) return null;
    const name = char.charAt(0).toUpperCase() + char.slice(1).toLowerCase();
    return `${inst}:${name}`;
  }

  async go2Get(char: string, instance = "GSIV"): Promise<Result<{ settings: Record<string, unknown> }>> {
    return this.readSettings(GO2_GET_SCRIPT, char, instance);
  }

  async go2Put(char: string, instance = "GSIV", settings: Record<string, unknown>): Promise<WriteResult> {
    return this.writeSettings(GO2_PUT_SCRIPT, char, instance, settings);
  }

  async eherbsGet(char: string, instance = "GSIV"): Promise<Result<{ settings: Record<string, unknown> }>> {
    return this.readSettings(EHERBS_GET_SCRIPT, char, instance);
  }

  async eherbsPut(char: string, instance = "GSIV", settings: Record<string, unknown>): Promise<WriteResult> {
    return this.writeSettings(EHERBS_PUT_SCRIPT, char, instance, settings);
  }

  private async readSettings(
    script: string,
    char: string,
    instance: string,
  ): Promise<Result<{ settings: Record<string, unknown> }>> {
    const scope = this.scopeFor(char, instance);
    if (!scope) return { ok: false, code: "invalid_input", error: "invalid character name or instance" };
    const res = await this.exec("ruby", ["-e", script, scope, this.dbPath], TIMEOUT_MS);
    if (res.code !== 0)
      return { ok: false, code: "exec", error: res.stderr.trim() || `ruby failed (code ${res.code})` };
    try {
      return { ok: true, settings: JSON.parse(res.stdout || "{}") as Record<string, unknown> };
    } catch {
      return { ok: false, code: "parse", error: "ruby returned invalid JSON" };
    }
  }

  private async writeSettings(
    script: string,
    char: string,
    instance: string,
    settings: Record<string, unknown>,
  ): Promise<WriteResult> {
    const scope = this.scopeFor(char, instance);
    if (!scope) return { ok: false, code: "invalid_input", error: "invalid character name or instance" };
    const res = await this.exec("ruby", ["-e", script, scope, this.dbPath, JSON.stringify(settings)], TIMEOUT_MS);
    if (res.code !== 0)
      return { ok: false, code: "exec", error: res.stderr.trim() || `ruby failed (code ${res.code})` };
    return { ok: true };
  }
}
