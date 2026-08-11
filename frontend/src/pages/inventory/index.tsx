import { useEffect, useState } from "react";
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

  async function refresh() {
    try {
      const path = `/modules/inventory/search${q ? `?q=${encodeURIComponent(q)}` : ""}`;
      setRows(await api<InvRow[]>(path, auth));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  return (
    <div>
      <h1>Inventory</h1>
      <p className="muted">Read-only view of the shared invdb (no write affordances).</p>
      <div className="toolbar">
        <input placeholder="search…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void refresh()} />
        <button className="btn" onClick={() => void refresh()}>Search</button>
      </div>
      {error && <p className="error">{error}</p>}
      <table className="data-table">
        <thead>
          <tr>
            {rows[0] && Object.keys(rows[0]).map((k) => <th key={k}>{k}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {Object.values(r).map((v, j) => (
                <td key={j}>{String(v ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && !error && <p className="muted">No items (inventory module may be unavailable on this backend).</p>}
    </div>
  );
}
