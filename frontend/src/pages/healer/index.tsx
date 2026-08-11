import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import { useWsEvents } from "../../core/useWs";
import { Card, Button, StatusDot, useToast } from "../../components";

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
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();
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
    } finally {
      setLoading(false);
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
    addToast({
      tone: "info",
      title: "Healers Updated",
      message: `${p.healers.length} healer(s) currently active.`,
    });
  });

  useWsEvents(["heal_request", "heal_accepted", "heal_complete"], (e) => {
    addToast({
      tone: "info",
      title: "Heal Event",
      message: `Heal queue event: ${e.type}`,
    });
    void refresh();
  });

  async function accept(req: HealRequest) {
    try {
      await api("/modules/healer/accept", auth, {
        method: "POST",
        body: JSON.stringify({ request_id: req.request_id, character: "me", target: req.character }),
      });
      addToast({
        tone: "good",
        title: "Request Accepted",
        message: `Accepted heal request for ${req.character}.`,
      });
      await refresh();
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      addToast({
        tone: "bad",
        title: "Action Failed",
        message: msg,
      });
    }
  }

  async function complete(req: HealRequest) {
    try {
      await api("/modules/healer/complete", auth, {
        method: "POST",
        body: JSON.stringify({ request_id: req.request_id, character: "me", target: req.character }),
      });
      addToast({
        tone: "good",
        title: "Request Completed",
        message: `Marked heal request for ${req.character} as complete.`,
      });
      await refresh();
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      addToast({
        tone: "bad",
        title: "Action Failed",
        message: msg,
      });
    }
  }

  const pending = requests.filter((r) => r.status === "pending");

  return (
    <div>
      <header className="page-header" style={{ flexDirection: "column" }}>
        <h1 className="page-header-title">Healer</h1>
        <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
          Pending heal requests + healer registry — live via WS.
        </p>
      </header>

      {error && (
        <div style={{ marginBottom: "var(--space-4)", padding: "var(--space-3)", background: "var(--tint-bad)", border: "1px solid var(--bad)", borderRadius: "var(--radius-sm)", color: "var(--text-strong)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="board-row">
        <Card
          title={`Pending requests (${pending.length})`}
          ariaLabel="Pending heal requests list"
        >
          {loading ? (
            <>
              <div className="board-item" aria-hidden="true"><span className="gs-skeleton gs-skeleton--bar" style={{ width: "40%", height: 14 }} /></div>
              <div className="board-item" aria-hidden="true"><span className="gs-skeleton gs-skeleton--bar" style={{ width: "40%", height: 14 }} /></div>
            </>
          ) : pending.map((r) => (
            <div key={r.request_id} className="board-item">
              <span className="board-name">{r.character}</span>
              <span className="muted">room {String(r.room_id)}</span>
              {r.hp != null && <span className="muted">hp {r.hp}</span>}
              {write && (
                <span className="row-actions" style={{ marginLeft: "auto" }}>
                  <Button size="sm" onClick={() => accept(r)} ariaLabel={`Accept heal request from ${r.character}`}>
                    Accept
                  </Button>
                  <Button size="sm" onClick={() => complete(r)} ariaLabel={`Complete heal request from ${r.character}`}>
                    Complete
                  </Button>
                </span>
              )}
            </div>
          ))}
          {!pending.length && !loading && <p className="muted" style={{ margin: 0 }}>Nothing pending.</p>}
        </Card>

        <Card
          title={`Healers (${healers.length})`}
          ariaLabel="Registered healers list"
        >
          {loading ? (
            <>
              <div className="board-item" aria-hidden="true"><span className="gs-skeleton gs-skeleton--bar" style={{ width: "40%", height: 14 }} /></div>
            </>
          ) : healers.map((h) => {
            const isAlive = Date.now() - h.last_heartbeat < 30_000;
            return (
              <div key={h.character} className="board-item">
                <StatusDot
                  color={isAlive ? "good" : "neutral"}
                  label={isAlive ? "active" : "inactive"}
                />
                <span className="board-name" style={{ marginLeft: "var(--control-gap)" }}>{h.character}</span>
                <span className="muted" style={{ marginLeft: "auto" }}>room {String(h.room_id)}</span>
              </div>
            );
          })}
          {!healers.length && !loading && <p className="muted" style={{ margin: 0 }}>No healers registered.</p>}
        </Card>
      </div>
    </div>
  );
}
