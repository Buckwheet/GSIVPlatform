import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import { useWsEvents } from "../../core/useWs";

interface HealerInfo {
  character: string;
  room_id: number | string;
  last_heartbeat: number;
}

interface HealRequest {
  request_id: string;
  character: string;
  room_id: number | string;
  hp?: number;
  status: string;
  healer?: string;
}

export default function Healer({ auth }: { auth: AuthState }) {
  const [healers, setHealers] = useState<HealerInfo[]>([]);
  const [requests, setRequests] = useState<HealRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const write = can(auth, ["healer.write"]);

  async function refresh() {
    try {
      const status = await api<{ healers: HealerInfo[]; pending: number }>("/modules/healer/status", auth);
      setHealers(status.healers);
      const reqs = await api<HealRequest[]>("/modules/healer/requests", auth);
      setRequests(reqs);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  useWsEvents(["healer_update"], (e) => {
    const p = e.payload as { healers: HealerInfo[] };
    setHealers(p.healers);
  });
  useWsEvents(["heal_request", "heal_accepted", "heal_complete"], () => void refresh());

  async function accept(req: HealRequest) {
    try {
      await api("/modules/healer/accept", auth, {
        method: "POST",
        body: JSON.stringify({ request_id: req.request_id, character: "me", target: req.character }),
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function complete(req: HealRequest) {
    try {
      await api("/modules/healer/complete", auth, {
        method: "POST",
        body: JSON.stringify({ request_id: req.request_id, character: "me", target: req.character }),
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const pending = requests.filter((r) => r.status === "pending");

  return (
    <div>
      <h1>Healer</h1>
      <p className="muted">Pending heal requests + healer registry — live via WS.</p>
      {error && <p className="error">{error}</p>}
      <div className="board-row">
        <section className="panel board-panel">
          <h2 className="section-title">Pending requests ({pending.length})</h2>
          {pending.map((r) => (
            <div key={r.request_id} className="board-item">
              <span className="board-name">{r.character}</span>
              <span className="muted">room {String(r.room_id)}</span>
              {r.hp != null && <span className="muted">hp {r.hp}</span>}
              {write && (
                <span className="row-actions">
                  <button className="btn" onClick={() => accept(r)}>Accept</button>
                  <button className="btn" onClick={() => complete(r)}>Complete</button>
                </span>
              )}
            </div>
          ))}
          {!pending.length && <p className="muted">Nothing pending.</p>}
        </section>
        <section className="panel board-panel">
          <h2 className="section-title">Healers ({healers.length})</h2>
          {healers.map((h) => (
            <div key={h.character} className="board-item">
              <span className={`status-dot ${Date.now() - h.last_heartbeat < 30_000 ? "good" : "muted"}`} />
              <span className="board-name">{h.character}</span>
              <span className="muted">room {String(h.room_id)}</span>
            </div>
          ))}
          {!healers.length && <p className="muted">No healers registered.</p>}
        </section>
      </div>
    </div>
  );
}
