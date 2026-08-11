import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import { useWsEvents } from "../../core/useWs";
import { Card, Button, Badge, useToast } from "../../components";

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
  const { addToast } = useToast();
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
      addToast({
        tone: "info",
        title: "Jars Updated",
        message: `Jar status for ${p.character} has been updated.`,
      });
    } else {
      const p = e.payload as { holder: string; responder: string };
      setJars((prev) =>
        prev.map((j) =>
          j.character === p.holder ? { ...j, responder: p.responder, claimed_at: Date.now() } : j
        )
      );
      addToast({
        tone: "good",
        title: "Jar Claimed",
        message: `${p.holder}'s jars claimed by ${p.responder}.`,
      });
    }
  });

  useWsEvents(["queue_update"], (e) => {
    const p = e.payload as { service: string; queue: string[] };
    setQueue((prev) => {
      const next = prev.filter((q) => q.service !== p.service);
      next.push(p);
      return next;
    });
    addToast({
      tone: "info",
      title: "Queue Updated",
      message: `Queue for ${p.service} has changed.`,
    });
  });

  async function claim(holder: string) {
    try {
      await api("/modules/gems/jars/claim", auth, {
        method: "POST",
        body: JSON.stringify({ holder, responder: "me" }),
      });
      addToast({
        tone: "good",
        title: "Claim Successful",
        message: `Successfully claimed ${holder}'s jars.`,
      });
      await refresh();
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      addToast({
        tone: "bad",
        title: "Claim Failed",
        message: msg,
      });
    }
  }

  async function clearJar(character: string) {
    try {
      await api("/modules/gems/jars/clear", auth, { method: "POST", body: JSON.stringify({ character }) });
      addToast({
        tone: "good",
        title: "Clear Successful",
        message: `Cleared jar status for ${character}.`,
      });
      await refresh();
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      addToast({
        tone: "bad",
        title: "Clear Failed",
        message: msg,
      });
    }
  }

  return (
    <div>
      <header className="page-header" style={{ flexDirection: "column" }}>
        <h1 className="page-header-title">Jars</h1>
        <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
          Jar statuses + the gembank queue — live via WS.
        </p>
      </header>

      {error && (
        <div style={{ marginBottom: "var(--space-4)", padding: "var(--space-3)", background: "var(--tint-bad)", border: "1px solid var(--bad)", borderRadius: "var(--radius-sm)", color: "var(--text-strong)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="jar-grid">
        {jars.map((j) => (
          <Card
            key={j.character}
            padding="default"
            ariaLabel={`Jar details for ${j.character}`}
            title={
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: "var(--control-gap)" }}>
                <span>{j.character}</span>
                {j.responder ? (
                  <Badge color="good" variant="tinted" label={`claimed: ${j.responder}`} />
                ) : null}
              </div>
            }
            footer={
              write ? (
                <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                  <Button
                    size="sm"
                    disabled={!!j.responder}
                    onClick={() => claim(j.character)}
                    ariaLabel={`Claim jars for ${j.character}`}
                  >
                    Claim
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => clearJar(j.character)}
                    ariaLabel={`Clear jars for ${j.character}`}
                  >
                    Clear
                  </Button>
                </div>
              ) : undefined
            }
          >
            <div className="jar-count">{j.full_jar_count} full</div>
            <ul className="jar-list">
              {j.full_jars.map((f, i) => (
                <li key={i}>
                  {f.type ?? "gem"} — <span className="muted">{f.portions} portions</span>
                </li>
              ))}
              {!j.full_jars.length && <li className="muted">no full jars</li>}
            </ul>
          </Card>
        ))}
        {!jars.length && !error && (
          <Card ariaLabel="Empty jars state">
            <p className="muted" style={{ margin: 0 }}>No jar statuses published.</p>
          </Card>
        )}
      </div>

      <h2 style={{ marginTop: "var(--section-gap)", marginBottom: "var(--space-2)" }}>Queue</h2>
      {queue.map((q) => (
        <Card
          key={q.service}
          padding="default"
          ariaLabel={`Service queue for ${q.service}`}
          title={q.service}
        >
          <div style={{ display: "flex", gap: "var(--control-gap)", flexWrap: "wrap", alignItems: "center" }}>
            {q.queue.map((name) => (
              <Badge key={name} color="neutral" variant="tinted" label={name} />
            ))}
            {!q.queue.length && <span className="muted">empty</span>}
          </div>
        </Card>
      ))}
    </div>
  );
}
