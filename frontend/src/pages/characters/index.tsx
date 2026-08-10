import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import type { CharacterRow } from "../../core/types";

const POLL_MS = 15_000; // polling fallback (ws-data-pattern.md §8) until the WS layer lands

export default function Characters({ auth }: { auth: AuthState }) {
  const [rows, setRows] = useState<CharacterRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const write = can(auth, ["characters.write"]);

  async function refresh() {
    try {
      setRows(await api<CharacterRow[]>("/modules/characters/characters", auth));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  async function act(name: string, action: "start" | "stop" | "restart") {
    setBusy(name);
    try {
      await api<{ ok: boolean }>(`/modules/characters/characters/${encodeURIComponent(name)}/${action}`, auth, { method: "POST" });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1>Characters</h1>
      <p className="muted">Headless Lich sessions · status polled every {POLL_MS / 1000}s (WS pending).</p>
      {error && <p className="error">{error}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Sub</th>
            <th>Uptime</th>
            <th>Managed</th>
            {write && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.char_name}>
              <td>{r.char_name}</td>
              <td>
                <span className={`status-dot ${r.active ? "good" : "muted"}`} title={r.active ? "online" : "offline"} />
                {r.active ? "online" : "offline"}
              </td>
              <td>{r.sub}</td>
              <td>{r.uptime != null ? `${Math.round(r.uptime / 60)}m` : "—"}</td>
              <td>{r.managed ? "yes" : "no"}</td>
              {write && (
                <td className="row-actions">
                  <button className="btn" disabled={busy === r.char_name || r.active} onClick={() => act(r.char_name, "start")}>
                    Start
                  </button>
                  <button className="btn" disabled={busy === r.char_name || !r.active} onClick={() => act(r.char_name, "stop")}>
                    Stop
                  </button>
                  <button className="btn" disabled={busy === r.char_name || !r.active} onClick={() => act(r.char_name, "restart")}>
                    Restart
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && !error && <p className="muted">No characters in entry.yaml.</p>}
    </div>
  );
}
