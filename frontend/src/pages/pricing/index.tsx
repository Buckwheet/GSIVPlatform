import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";

interface SaleRow {
  item?: string;
  seller?: string;
  buyer?: string;
  price?: number;
  removed_date?: string;
  [k: string]: unknown;
}

export default function Pricing({ auth }: { auth: AuthState }) {
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const canScrape = can(auth, ["pricing.scrape"]);

  async function refresh() {
    try {
      setRows(await api<SaleRow[]>("/modules/pricing/sales", auth));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  async function runJob() {
    try {
      await api("/modules/pricing/scrape", auth, { method: "POST", body: "{}" });
      setTimeout(() => void refresh(), 2_000);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h1>Pricing</h1>
      <p className="muted">Recent sales from the pricing module.</p>
      {canScrape && (
        <div className="toolbar">
          <button className="btn" onClick={() => void runJob()}>Run scraper job</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <table className="data-table">
        <thead>
          <tr><th>Item</th><th>Seller</th><th>Buyer</th><th>Price</th><th>Date</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{String(r.item ?? "")}</td>
              <td>{String(r.seller ?? "")}</td>
              <td>{String(r.buyer ?? "")}</td>
              <td>{typeof r.price === "number" ? r.price.toLocaleString() : String(r.price ?? "")}</td>
              <td>{String(r.removed_date ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && !error && <p className="muted">No sales yet.</p>}
    </div>
  );
}
