import { useEffect, useState } from "react";
import { Button, Input, useToast } from "../../components";
import { api } from "../../core/api";
import { type AuthState, can } from "../../core/auth";

interface ScheduleState {
  enabled: boolean;
  time: string | null;
  next_run: string | null;
  error: string | null;
}
interface ScanStatus {
  running: boolean;
  last_log: string | null;
  chars: number;
  items: number;
  data_as_of: string | null;
}

function parseHm(v: string): number | null {
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
function fmtMin(t: number): string {
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
const wrap = (t: number) => ((t % 1440) + 1440) % 1440;

export function InventoryScheduler({ auth }: { auth: AuthState }) {
  const [serverNow, setServerNow] = useState<Date | null>(null);
  const [offsetH, setOffsetH] = useState(-5); // user's UTC offset in hours (default EST)
  const [myTime, setMyTime] = useState("");
  const [srvTime, setSrvTime] = useState("");
  const [sched, setSched] = useState<ScheduleState | null>(null);
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const { addToast } = useToast();
  const canWrite = can(auth, ["inventory.write"]);

  async function refreshAll() {
    try {
      const [t, sc, st] = await Promise.all([
        api<{ now: string }>("/modules/inventory/time", auth),
        api<ScheduleState>("/modules/inventory/schedule", auth),
        api<ScanStatus>("/modules/inventory/scan/status", auth),
      ]);
      setServerNow(new Date(t.now));
      setSched(sc);
      setStatus(st);
    } catch (err) {
      addToast({ tone: "bad", title: "Scheduler unavailable", message: (err as Error).message });
    }
  }

  useEffect(() => {
    if (!can(auth, ["inventory.read"])) return;
    void refreshAll();
    const timer = setInterval(() => setServerNow((d) => (d ? new Date(d.getTime() + 1000) : d)), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  const myMin = parseHm(myTime);
  const serverFromMy = myMin === null ? null : fmtMin(wrap(myMin - Math.round(offsetH * 60)));
  const srvMin = parseHm(srvTime);
  const myFromServer = srvMin === null ? null : fmtMin(wrap(srvMin + Math.round(offsetH * 60)));

  async function setSchedule(time: string) {
    setBusy(true);
    try {
      await api("/modules/inventory/schedule", auth, { method: "PUT", body: JSON.stringify({ time }) });
      addToast({ tone: "good", title: "Schedule set", message: `InvDB scan daily at ${time} server time (UTC).` });
      setSched(await api<ScheduleState>("/modules/inventory/schedule", auth));
    } catch (err) {
      addToast({ tone: "bad", title: "Set schedule failed", message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function scanNow() {
    setBusy(true);
    try {
      await api("/modules/inventory/scan/start", auth, { method: "POST", body: "{}" });
      addToast({ tone: "good", title: "Scan started", message: "invdb scan-all launched (see scan status)." });
      setTimeout(() => void refreshAll(), 3000);
    } catch (err) {
      addToast({ tone: "bad", title: "Scan start failed", message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const clock = serverNow ? serverNow.toISOString().slice(11, 19) : "--:--:--";

  return (
    <div className="card" style={{ marginBottom: "var(--space-4)" }}>
      <div className="card-title">InvDB Scan Scheduler</div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", alignItems: "flex-start" }}>
        <div style={{ minWidth: 180 }}>
          <div className="muted">Server clock (UTC)</div>
          <div style={{ fontSize: "var(--font-size-xl)", fontVariantNumeric: "tabular-nums" }}>{clock}</div>
          <div className="muted" style={{ marginTop: "var(--space-2)" }}>
            {sched
              ? sched.enabled
                ? `Scheduled daily at ${sched.time} UTC` +
                  (sched.next_run ? ` · next ${new Date(sched.next_run).toISOString().slice(0, 16)}Z` : "")
                : "No schedule set"
              : "…"}
          </div>
        </div>

        <div style={{ minWidth: 240 }}>
          <div className="muted" style={{ marginBottom: "var(--space-1)" }}>
            Your UTC offset (hours)
          </div>
          <Input
            id="offsetH"
            type="number"
            value={String(offsetH)}
            onChange={(v) => setOffsetH(Number(v) || 0)}
            style={{ maxWidth: 110 }}
            label="UTC offset (hours, e.g. -5)"
          />
        </div>

        <div style={{ minWidth: 240 }}>
          <div className="muted" style={{ marginBottom: "var(--space-1)" }}>
            Your time → server time
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
            <Input
              id="myTime"
              placeholder="23:00"
              value={myTime}
              onChange={setMyTime}
              style={{ maxWidth: 90 }}
              label="Your time"
            />
            <span className="muted">=</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{serverFromMy ?? "—"}</span>
            <span className="muted">UTC</span>
            {canWrite && (
              <Button
                size="sm"
                disabled={!serverFromMy || busy}
                onClick={() => serverFromMy && void setSchedule(serverFromMy)}
                ariaLabel="Set scan time from my time"
              >
                Set
              </Button>
            )}
          </div>
        </div>

        <div style={{ minWidth: 240 }}>
          <div className="muted" style={{ marginBottom: "var(--space-1)" }}>
            Server time (UTC) {srvMin !== null && myFromServer ? `→ your ${myFromServer}` : ""}
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
            <Input
              id="srvTime"
              placeholder="03:00"
              value={srvTime}
              onChange={setSrvTime}
              style={{ maxWidth: 90 }}
              label="Server time"
            />
            {canWrite && (
              <Button
                size="sm"
                disabled={srvMin === null || busy}
                onClick={() => srvMin !== null && void setSchedule(srvTime)}
                ariaLabel="Set scan time (server)"
              >
                Set
              </Button>
            )}
          </div>
        </div>

        <div style={{ minWidth: 200 }}>
          <div className="muted" style={{ marginBottom: "var(--space-1)" }}>
            Actions
          </div>
          {canWrite ? (
            <Button onClick={scanNow} loading={busy} disabled={status?.running} ariaLabel="Run invdb scan now">
              {status?.running ? "Scan running…" : "Run scan now"}
            </Button>
          ) : (
            <span className="muted">read-only token</span>
          )}
        </div>
      </div>

      {status && (
        <div className="muted" style={{ marginTop: "var(--space-3)", fontSize: "var(--font-size-sm)" }}>
          {status.running ? "● scan running" : `last scan finished`} · {status.chars} chars · {status.items} items
          {status.data_as_of ? ` · data as of ${new Date(status.data_as_of).toISOString().slice(11, 16)}Z` : ""}
          {status.last_log ? ` · ${status.last_log.split("\n").slice(-2).join(" | ")}` : ""}
        </div>
      )}
      {sched?.error && (
        <div
          className="muted"
          style={{ marginTop: "var(--space-2)", fontSize: "var(--font-size-sm)", color: "var(--bad)" }}
        >
          scheduler error: {sched.error}
        </div>
      )}
    </div>
  );
}
