import { useEffect, useState } from "react";
import { api } from "../core/api";
import { onWs } from "../core/ws";
import { can, type AuthState } from "../core/auth";
import { Button, useToast } from "../components";

interface Notification {
  id: number;
  shop: string;
  name: string;
  cost: number | null;
  removed_date: string;
}
interface NotifResponse {
  total: number;
  unread: number;
  notifications: Notification[];
}

export function Bell({ auth }: { auth: AuthState }) {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const { addToast } = useToast();

  async function refresh() {
    try {
      const res = await api<NotifResponse>("/modules/your-shops/notifications", auth);
      setUnread(res.unread);
      setItems(res.notifications.slice(0, 20));
    } catch {
      // bell silently degrades if the module is unreachable
    }
  }

  useEffect(() => {
    if (!can(auth, ["yourshops.read"])) return;
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

  if (!can(auth, ["yourshops.read"])) return null;

  async function markAllRead() {
    try {
      await api("/modules/your-shops/notifications/ack", auth, { method: "POST", body: "{}" });
      setUnread(0);
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
            width: 320,
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
            <strong>Sales</strong>
            {unread > 0 && (
              <Button variant="ghost" size="sm" onClick={markAllRead} ariaLabel="Mark all read">
                Mark all read
              </Button>
            )}
          </div>
          {items.length === 0 && <div className="muted" style={{ padding: "var(--space-2)" }}>No sales yet.</div>}
          {items.map((n) => (
            <div
              key={n.id}
              style={{ padding: "var(--space-2) 0", borderBottom: "1px solid var(--border)", fontSize: "var(--font-size-sm)" }}
            >
              <div>{n.name}</div>
              <div className="muted">
                {n.shop} · {typeof n.cost === "number" ? n.cost.toLocaleString() : "—"} · {new Date(n.removed_date).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
