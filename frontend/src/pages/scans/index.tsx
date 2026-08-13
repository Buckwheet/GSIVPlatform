import { useEffect, useState } from "react";
import { Button, Input, useToast } from "../../components";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import { useWsEvents } from "../../core/useWs";

interface ScanAccountState {
  account: string;
  chars: string[];
  status: string;
  charsDone: number;
  charsFailed: number;
  current: string | null;
  stage: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}
interface ScanJob {
  id: number;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  accounts: ScanAccountState[];
}
interface ScanStatus {
  running: boolean;
  job: ScanJob | null;
}
interface HistoryAccount {
  account_name: string;
  status: string;
  chars_total: number;
  chars_done: number;
  chars_failed: number;
  error: string | null;
}
interface HistoryJob {
  id: number;
  status: string;
  started_at: number;
  finished_at: number | null;
  total_accounts: number;
  accounts_done: number;
  accounts_failed: number;
  accounts: HistoryAccount[];
}
interface Target {
  account: string;
  chars: string[];
}
interface ScheduleState {
  enabled: boolean;
  time: string | null;
  next_run: string | null;
  error: string | null;
}

const STAGE_LABEL: Record<string, string> = {
  starting: "starting",
  waiting_online: "waiting online",
  scanning: "scanning",
  tickets: "tickets",
  done: "done",
  failed: "failed",
  timeout: "timed out",
};

export default function Scans({ auth }: { auth: AuthState }) {
  const [status, setStatus] = useState<ScanStatus>({ running: false, job: null });
  const [history, setHistory] = useState<HistoryJob[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [sched, setSched] = useState<ScheduleState | null>(null);
  const [serverNow, setServerNow] = useState<Date | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [schedTime, setSchedTime] = useState("");
  const [busy, setBusy] = useState(false);
  const { addToast } = useToast();
  const canWrite = can(auth, ["scans.write"]);

  async function refreshStatus() {
    try {
      setStatus(await api<ScanStatus>("/modules/scans/scan/status", auth));
    } catch {
      /* degrade silently; the page still renders history */
    }
  }
  async function refreshAll() {
    try {
      const [st, h, t, sc, tm] = await Promise.all([
        api<ScanStatus>("/modules/scans/scan/status", auth),
        api<{ jobs: HistoryJob[] }>("/modules/scans/scan/history", auth),
        api<Target[]>("/modules/scans/scan/targets", auth),
        api<ScheduleState>("/modules/scans/schedule", auth),
        api<{ now: string }>("/modules/scans/time", auth),
      ]);
      setStatus(st);
      setHistory(h.jobs);
      setTargets(t);
      setSched(sc);
      setServerNow(new Date(tm.now));
    } catch (err) {
      addToast({ tone: "bad", title: "Scans unavailable", message: (err as Error).message });
    }
  }

  useEffect(() => {
    if (!can(auth, ["scans.read"])) return;
    void refreshAll();
    const timer = setInterval(() => setServerNow((d) => (d ? new Date(d.getTime() + 1000) : d)), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  useWsEvents(["scan_update"], () => void refreshStatus());

  async function scanNow() {
    setBusy(true);
    try {
      const body = selected.size > 0 ? { accounts: [...selected] } : {};
      const res = await api<{ ok: boolean; jobId: number; totalAccounts: number }>("/modules/scans/scan", auth, {
        method: "POST",
        body: JSON.stringify(body),
      });
      addToast({ tone: "good", title: "Scan started", message: `${res.totalAccounts} account(s) queued.` });
      void refreshStatus();
    } catch (err) {
      addToast({ tone: "bad", title: "Scan start failed", message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function retry(jobId: number) {
    setBusy(true);
    try {
      await api("/modules/scans/scan/" + jobId + "/retry", auth, { method: "POST", body: "{}" });
      addToast({ tone: "good", title: "Retry started", message: "Failed accounts re-queued." });
      void refreshStatus();
    } catch (err) {
      addToast({ tone: "bad", title: "Retry failed", message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function setSchedule(time: string) {
    setBusy(true);
    try {
      await api("/modules/scans/schedule", auth, { method: "PUT", body: JSON.stringify({ time }) });
      setSched(await api<ScheduleState>("/modules/scans/schedule", auth));
      addToast({ tone: "good", title: "Schedule set", message: `Daily scan at ${time} UTC.` });
    } catch (err) {
      addToast({ tone: "bad", title: "Set schedule failed", message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const job = status.job;
  const running = job?.accounts.filter((a) => a.status === "running") ?? [];
  const queued = job?.accounts.filter((a) => a.status === "queued") ?? [];
  const clock = serverNow ? serverNow.toISOString().slice(11, 19) : "--:--:--";

  return (
    <div>
      <header className="page-header">
        <h1 className="page-header-title">Scans</h1>
        <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
          InvDB collection orchestrator — {job?.accounts.length ?? 0} account(s), 5 at a time.
        </p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
        <div className="card" style={{ flex: "1 1 260px" }}>
          <div className="card-title">Schedule</div>
          <div className="muted">Server clock (UTC)</div>
          <div style={{ fontSize: "var(--font-size-xl)", fontVariantNumeric: "tabular-nums" }}>{clock}</div>
          <div className="muted" style={{ marginTop: "var(--space-2)" }}>
            {sched
              ? sched.enabled
                ? `Daily at ${sched.time} UTC` + (sched.next_run ? ` · next ${sched.next_run}` : "")
                : "No schedule set"
              : "…"}
          </div>
          {canWrite && (
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", marginTop: "var(--space-2)" }}>
              <Input
                id="schedTime"
                placeholder="03:00"
                value={schedTime}
                onChange={setSchedTime}
                style={{ maxWidth: 90 }}
                label="Daily time (UTC)"
              />
              <Button size="sm" disabled={!/^\d{2}:\d{2}$/.test(schedTime) || busy} onClick={() => void setSchedule(schedTime)} ariaLabel="Set scan schedule">
                Set
              </Button>
            </div>
          )}
        </div>

        <div className="card" style={{ flex: "1 1 340px" }}>
          <div className="card-title">Run a scan</div>
          {targets.length > 0 && (
            <div style={{ marginBottom: "var(--space-2)", maxHeight: 180, overflowY: "auto" }}>
              {targets.map((t) => (
                <label key={t.account} style={{ display: "block", fontSize: "var(--font-size-sm)" }}>
                  <input
                    type="checkbox"
                    checked={selected.has(t.account)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(t.account);
                      else next.delete(t.account);
                      setSelected(next);
                    }}
                  />{" "}
                  {t.account} <span className="muted">({t.chars.length} chars)</span>
                </label>
              ))}
            </div>
          )}
          {canWrite ? (
            <Button onClick={scanNow} loading={busy} disabled={status.running} ariaLabel="Run invdb scan now">
              {status.running ? "Scan running…" : selected.size > 0 ? `Scan ${selected.size} account(s)` : 
"Scan all accounts"}
            </Button>
          ) : (
            <span className="muted">read-only token</span>
          )}
        </div>
      </div>

      {job && (
        <div className="card" style={{ marginBottom: "var(--space-4)" }}>
          <div className="card-title">{status.running ? "Scan in progress" : `Last scan — ${job.status}`}</div>
          {[...running, ...queued].map((a) => {
            const pct = a.chars.length === 0 ? 0 : Math.round((a.charsDone / a.chars.length) * 100);
            return (
              <div key={a.account} style={{ padding: "var(--space-2) 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{a.account}</strong>
                  <span className="muted" style={{ fontSize: "var(--font-size-sm)" }}>
                    {a.charsDone}/{a.chars.length} chars · {a.status}
                  </span>
                </div>
                <div style={{ height: 6, background: "var(--border)", borderRadius: 3, margin: "var(--space-1) 0", overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width 0.3s" }} />
                </div>
                {a.current && (
                  <div className="muted" style={{ fontSize: "var(--font-size-sm)" }}>
                    <span className="scan-pulse">●</span> {a.current} — {STAGE_LABEL[a.stage ?? ""] ?? a.stage}
                  </div>
                )}
                {a.error && <div className="muted" style={{ fontSize: "var(--font-size-sm)", color: "var(--bad)" }}>{a.error}</div>}
              </div>
            );
          })}
          {job.accounts.filter((a) => a.status === "failed" || a.status === "partial").length > 0 && !status.running && canWrite && (
            <div style={{ marginTop: "var(--space-2)" }}>
              <Button size="sm" onClick={() => void retry(job.id)} loading={busy} ariaLabel="Retry failed accounts">
                Retry failed accounts
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-title">History</div>
        {history.length === 0 ? (
          <div className="muted">No scans yet.</div>
        ) : (
          history.slice(0, 10).map((h) => (
            <div key={h.id} style={{ padding: "var(--space-2) 0", borderBottom: "1px solid var(--border)", fontSize: "var(--font-size-sm)" }}>
              <strong>#{h.id}</strong> {h.status} · {h.accounts_done} ok / {h.accounts_failed} failed ·{" "}
              {new Date(h.started_at).toISOString().slice(0, 16)}Z
              {h.accounts_failed > 0 && canWrite && (
                <Button size="sm" variant="ghost" style={{ marginLeft: "var(--space-2)" }} onClick={() => void retry(h.id)} ariaLabel={`Retry job ${h.id}`}>
                  retry
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
