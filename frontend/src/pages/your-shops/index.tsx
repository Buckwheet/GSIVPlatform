import { useEffect, useMemo, useState } from "react";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import { Button, Table, useToast } from "../../components";

interface Sale {
  item_id: string;
  name: string;
  town: string;
  shop: string;
  cost: number | null;
  removed_date: string;
}
interface SalesResponse {
  total: number;
  sales: Sale[];
}
interface Shop {
  id: number;
  name: string;
  town: string | null;
  created_at: string;
}

function fmtCost(cost: number | null): string {
  return typeof cost === "number" ? cost.toLocaleString() : "";
}
function daysAgo(days: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

export default function YourShops({ auth }: { auth: AuthState }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [newShops, setNewShops] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();
  const canWrite = can(auth, ["yourshops.write"]);

  async function load() {
    try {
      const [sh, sa] = await Promise.all([
        api<Shop[]>("/modules/your-shops/shops", auth),
        api<SalesResponse>("/modules/your-shops/sales", auth),
      ]);
      setShops(sh);
      setSales(sa.sales);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  const stats = useMemo(() => {
    const today = daysAgo(0);
    const week = daysAgo(7);
    const by = (from: number) => sales.filter((s) => new Date(s.removed_date).getTime() >= from);
    const sum = (rows: Sale[]) => rows.reduce((n, r) => n + (r.cost ?? 0), 0);
    return {
      today: { n: by(today).length, revenue: sum(by(today)) },
      week: { n: by(week).length, revenue: sum(by(week)) },
      all: { n: sales.length, revenue: sum(sales) },
    };
  }, [sales]);

  async function saveShops() {
    const names = newShops
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    try {
      await api("/modules/your-shops/shops", auth, { method: "PUT", body: JSON.stringify({ names }) });
      setNewShops("");
      addToast({ tone: "good", title: "Shops updated", message: `${names.length} shop${names.length === 1 ? "" : "s"} tracked.` });
      await load();
    } catch (err) {
      addToast({ tone: "bad", title: "Update failed", message: (err as Error).message });
    }
  }

  const columns = [
    { key: "name", header: "Item" },
    { key: "shop", header: "Shop" },
    { key: "town", header: "Town" },
    {
      key: "cost",
      header: "Price",
      align: "right" as const,
      render: (r: Sale) => fmtCost(r.cost),
    },
    { key: "removed_date", header: "Date", render: (r: Sale) => new Date(r.removed_date).toLocaleString() },
  ];

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-header-title">Your Shops</h1>
          <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
            Sales from your shops: {shops.map((s) => s.name).join(", ") || "none configured"}.
          </p>
        </div>
        {canWrite && (
          <div className="page-header-actions">
            <input
              value={newShops}
              onChange={(e) => setNewShops(e.target.value)}
              placeholder="Add shops, comma-separated"
              aria-label="Shop names"
              style={{ padding: "var(--space-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}
            />
            <Button onClick={saveShops} disabled={!newShops.trim()} ariaLabel="Save Shops">
              Save shops
            </Button>
          </div>
        )}
      </header>

      <div className="tile-grid" style={{ marginBottom: "var(--space-4)" }}>
        <div className="card">
          <div className="card-title">Today</div>
          <div className="tile-value">
            {stats.today.n} sales · {fmtCost(stats.today.revenue)}
          </div>
        </div>
        <div className="card">
          <div className="card-title">Last 7 days</div>
          <div className="tile-value">
            {stats.week.n} sales · {fmtCost(stats.week.revenue)}
          </div>
        </div>
        <div className="card">
          <div className="card-title">All time</div>
          <div className="tile-value">
            {stats.all.n} sales · {fmtCost(stats.all.revenue)}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: "var(--space-4)", padding: "var(--space-3)", background: "var(--tint-bad)", border: "1px solid var(--bad)", borderRadius: "var(--radius-sm)", color: "var(--text-strong)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <Table
        columns={columns}
        rows={sales}
        rowKey={(r) => r.item_id}
        ariaLabel="Sales from your shops"
        emptyState="No sales tracked yet."
        loading={loading}
      />
    </div>
  );
}
