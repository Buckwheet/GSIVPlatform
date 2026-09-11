import { useEffect, useState } from "react";
import { api } from "../core/api";
import { onWs } from "../core/ws";
import { can, type AuthState } from "../core/auth";
import { Button, useToast } from "../components";

/**
 * The shell's 🔔 bell.
 *
 * It merges every notification feed the token can read — `updates` (a new
 * VellumFE release is out; the dashboard's upgrade trigger) and `your-shops`
 * (something sold from a tracked shop) — into one badge. Each item carries its
 * own read state, and "Mark all read" acks the source that owns those items, so
 * acking one feed never touches the other.
 */

type SourceId = "updates" | "sales";

interface BellItem {
  key: string;
  title: string;
  /** External link for the item (a release page), when the source has one. */
  href?: string;
  detail: string;
  unread: boolean;
}

interface SourceState {
  label: string;
  unread: number;
  items: BellItem[];
  /** Source-level status line (the updates feed reports the deployed version here). */
  note?: string;
}

/** Sales = the tracked-shop feed. */
interface SalesNotification {
  id: number;
  shop: string;
  name: string;
  cost: number | null;
  removed_date: string;
  acknowledged_at: string | null;
}
interface SalesResponse {
  total: number;
  unread: number;
  notifications: SalesNotification[];
}

/** Updates = upstream VellumFE releases. */
interface UpdateNotification {
  id: number;
  tag: string;
  url: string;
  published_at: string | null;
  created_at: string;
  acknowledged_at: string | null;
}
interface UpdateStatus {
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
}
interface UpdatesResponse {
  total: number;
  unread: number;
  notifications: UpdateNotification[];
  status: UpdateStatus;
}

const ACK_PATH: Record<SourceId, string> = {
  updates: "/modules/updates/notifications/ack",
  sales: "/modules/your-shops/notifications/ack",
};
/** Actionable alerts first: a release we haven't taken outranks a sale. */
const SOURCE_ORDER: SourceId[] = ["updates", "sales"];

function updateNote(status: UpdateStatus): string {
  if (status.lastError) return `Last check failed: ${status.lastError}`;
  if (status.updateAvailable) {
    return `Update available: ${status.latest} (deployed ${status.current ?? "unknown"})`;
  }
  if (!status.current) return "Deployed version unknown — set VELLUM_VERSION on the server";
  if (!status.latest) return `VellumFE ${status.current} — no release seen yet`;
  return `VellumFE ${status.current} — up to date`;
}

export function Bell({ auth }: { auth: AuthState }) {
  const [sources, setSources] = useState<Partial<Record<SourceId, SourceState>>>({});
  const [open, setOpen] = useState(false);
  const { addToast } = useToast();

  const readUpdates = can(auth, ["updates.read"]);
  const readSales = can(auth, ["yourshops.read"]);

  async function refresh() {
    const next: Partial<Record<SourceId, SourceState>> = {};
    if (readUpdates) {
      try {
        const res = await api<UpdatesResponse>("/modules/updates/notifications", auth);
        next.updates = {
          label: "Updates",
          unread: res.unread,
          note: updateNote(res.status),
          items: res.notifications.map((n) => ({
            key: `updates-${n.id}`,
            title: n.tag,
            href: n.url,
            detail: n.published_at
              ? `released ${new Date(n.published_at).toLocaleDateString()}`
              : "new VellumFE release",
            unread: n.acknowledged_at === null,
          })),
        };
      } catch {
        // feed silently degrades if the module is unreachable
      }
    }
    if (readSales) {
      try {
        const res = await api<SalesResponse>("/modules/your-shops/notifications", auth);
        next.sales = {
          label: "Sales",
          unread: res.unread,
          items: res.notifications.slice(0, 20).map((n) => ({
            key: `sales-${n.id}`,
            title: n.name,
            detail: `${n.shop} · ${typeof n.cost === "number" ? n.cost.toLocaleString() : "—"} · ${new Date(n.removed_date).toLocaleString()}`,
            unread: false, // the sales feed has no per-item read state (ack is all-or-nothing)
          })),
        };
      } catch {
        // ignore
      }
    }
    setSources(next);
  }

  useEffect(() => {
    if (!readUpdates && !readSales) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  useEffect(() => {
    return onWs((e) => {
      if (e.type !== "sale_update") return;
      const count = (e.payload as { count?: number })?.count ?? 1;
      addToast({
        tone: "good",
        title: "🏪 New sale",
        message: `${count} item${count === 1 ? "" : "s"} sold from your shops`,
      });
      void refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  if (!readUpdates && !readSales) return null;

  const unread = SOURCE_ORDER.reduce((n, id) => n + (sources[id]?.unread ?? 0), 0);

  async function markAllRead(id: SourceId) {
    try {
      await api(ACK_PATH[id], auth, { method: "POST", body: "{}" });
      setSources((prev) => {
        const src = prev[id];
        if (!src) return prev;
        return { ...prev, [id]: { ...src, unread: 0, items: src.items.map((it) => ({ ...it, unread: false })) } };
      });
      void refresh();
    } catch {
      // ignore
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        ariaLabel={unread > 0 ? `Notifications: ${unread} unread` : "Notifications"}
        ariaPressed={open}
      >
        🔔{unread > 0 ? ` ${unread}` : ""}
      </Button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            width: 340,
            maxHeight: 420,
            overflowY: "auto",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            zIndex: 50,
            padding: "var(--space-2)",
          }}
        >
          {SOURCE_ORDER.map((id) => {
            const src = sources[id];
            if (!src) return null;
            return (
              <div key={id} style={{ marginBottom: "var(--space-2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{src.label}</strong>
                  {src.unread > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => void markAllRead(id)} ariaLabel={`Mark all ${src.label} read`}>
                      Mark all read
                    </Button>
                  )}
                </div>
                {src.note && (
                  <div className="muted" style={{ fontSize: "var(--font-size-sm)", paddingBottom: "var(--space-1)" }}>
                    {src.note}
                  </div>
                )}
                {src.items.length === 0 && (
                  <div className="muted" style={{ padding: "var(--space-2) 0" }}>
                    Nothing yet.
                  </div>
                )}
                {src.items.map((it) => (
                  <div
                    key={it.key}
                    style={{
                      display: "flex",
                      gap: "var(--space-2)",
                      alignItems: "baseline",
                      padding: "var(--space-2) 0",
                      borderBottom: "1px solid var(--border)",
                      fontSize: "var(--font-size-sm)",
                    }}
                  >
                    <span
                      aria-label={it.unread ? "unread" : "read"}
                      title={it.unread ? "unread" : "read"}
                      style={{
                        flex: "0 0 auto",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: it.unread ? "var(--warn)" : "transparent",
                      }}
                    />
                    <div>
                      <div>
                        {it.href ? (
                          <a href={it.href} target="_blank" rel="noreferrer">
                            {it.title}
                          </a>
                        ) : (
                          it.title
                        )}
                      </div>
                      <div className="muted">{it.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
