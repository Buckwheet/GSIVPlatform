import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import { useWsEvents } from "../../core/useWs";

interface JarStatus {
  character: string;
  full_jars: { id: string | number; type: string | null; portions: number }[];
  full_jar_count: number;
  responder?: string | null;
  claimed_at?: number | null;
}

interface QueueRow {
  service: string;
  queue: string[];
}

export default function Jars({ auth }: { auth: AuthState }) {
  const [jars, setJars] = useState<JarStatus[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const write = can(auth, ["gems.write"]);

  async function refresh() {
    try {
      setJars(await api<JarStatus[]>("/modules/gems/jars", auth));
      const q = await api<string[]>("/modules/gems/queue/status/gembank", auth);
      setQueue([{ service: "gembank", queue: q }]);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  // Live updates (Phase B WS): deltas patch the board in place.
  useWsEvents(["jars_update", "jars_claimed"], (e) => {
    if (e.type === "jars_update") {
      const p = e.payload as { character: string; data: JarStatus };
      setJars((prev) => {
        const next = prev.filter((j) => j.character !== p.character);
        next.push(p.data);
        return next.sort((a, b) => a.character.localeCompare(b.character));
      });
    } else {
      const p = e.payload as { holder: string; responder: string };
      setJars((prev) => prev.map((j) => (j.character === p.holder ? { ...j, responder: p.responder, claimed_at: Date.now() } : j)));
    }
  });

  useWsEvents(["queue_update"], (e) => {
    const p = e.payload as { service: string; queue: string[] };
    setQueue((prev) => {
      const next = prev.filter((q) => q.service !== p.service);
      next.push(p);
      return next;
    });
  });

  async function claim(holder: string) {
    try {
      await api("/modules/gems/jars/claim", auth, {
        method: "POST",
        body: JSON.stringify({ holder, responder: "me" }),
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function clearJar(character: string) {
    try {
      await api("/modules/gems/jars/clear", auth, { method: "POST", body: JSON.stringify({ character }) });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h1>Jars</h1>
      <p className="muted">Jar statuses + the gembank queue — live via WS.</p>
      {error && <p className="error">{error}</p>}
      <div className="jar-grid">
        {jars.map((j) => (
          <div key={j.character} className="jar-card panel">
            <div className="jar-title">
              {j.character}
              {j.responder ? <span className="jar-claimed"> claimed by {j.responder}</span> : null}
            </div>
            <div className="jar-count">{j.full_jar_count} full</div>
            <ul className="jar-list">
              {j.full_jars.map((f, i) => (
                <li key={i}>
                  {f.type ?? "gem"} — {f.portions} portions
                </li>
              ))}
              {!j.full_jars.length && <li className="muted">no full jars</li>}
            </ul>
            {write && (
              <div className="row-actions">
                <button className="btn" disabled={!!j.responder} onClick={() => claim(j.character)}>
                  Claim
                </button>
                <button className="btn" onClick={() => clearJar(j.character)}>
                  Clear
                </button>
              </div>
            )}
          </div>
        ))}
        {!jars.length && !error && <p className="muted">No jar statuses published.</p>}
      </div>
      <h2 className="muted section-title">Queue</h2>
      {queue.map((q) => (
        <div key={q.service} className="queue-strip panel">
          <span className="queue-service">{q.service}</span>
          {q.queue.map((name) => (
            <span key={name} className="queue-chip">{name}</span>
          ))}
          {!q.queue.length && <span className="muted">empty</span>}
        </div>
      ))}
    </div>
  );
}
