import { useEffect, useState } from "react";
import { Button, Input, Table, useToast } from "../../components";
import { api } from "../../core/api";
import type { AuthState } from "../../core/auth";

interface InvRow {
  id?: string | number;
  name?: string;
  location?: string;
  [k: string]: unknown;
}

export default function Inventory({ auth }: { auth: AuthState }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<InvRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const { addToast } = useToast();

  async function refresh() {
    setSearching(true);
    try {
      const path = `/modules/inventory/search${q ? `?q=${encodeURIComponent(q)}` : ""}`;
      setRows(await api<InvRow[]>(path, auth));
      setError(null);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      addToast({
        tone: "bad",
        title: "Search Failed",
        message: msg,
      });
    } finally {
      setSearching(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  const columns = rows[0]
    ? Object.keys(rows[0]).map((key) => ({
        key,
        header: key,
        sortable: true,
        render: (r: InvRow) => String(r[key] ?? ""),
      }))
    : [];

  return (
    <div>
      <header className="page-header" style={{ flexDirection: "column" }}>
        <h1 className="page-header-title">Inventory</h1>
        <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
          Read-only view of the shared invdb.
        </p>
      </header>


      <div className="toolbar" style={{ maxWidth: "420px", marginBottom: "var(--space-4)" }}>
        <Input
          id="inventorySearch"
          placeholder="search item, location..."
          value={q}
          onChange={setQ}
          className="search-input"
          onKeyDown={(e: any) => e.key === "Enter" && void refresh()}
        />
        <Button onClick={refresh} loading={searching} ariaLabel="Search inventory">
          Search
        </Button>
      </div>

      {error && (
        <div
          style={{
            marginBottom: "var(--space-4)",
            padding: "var(--space-3)",
            background: "var(--tint-bad)",
            border: "1px solid var(--bad)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-strong)",
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r, idx) => String(r.id ?? idx)}
        ariaLabel="Character inventory item list"
        loading={loading}
        emptyState="No items found (inventory module may be unavailable on this backend)."
      />
    </div>
  );
}
