import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import { Button, Table, useToast } from "../../components";

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
  const [scraping, setScraping] = useState(false);
  const { addToast } = useToast();
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
    setScraping(true);
    try {
      await api("/modules/pricing/scrape", auth, { method: "POST", body: "{}" });
      addToast({
        tone: "good",
        title: "Scraper Queued",
        message: "Scrape job has been requested successfully.",
      });
      setTimeout(() => {
        void refresh().then(() => setScraping(false));
      }, 2_000);
    } catch (err) {
      setError((err as Error).message);
      setScraping(false);
    }
  }

  const columns = [
    { key: "item", header: "Item", sortable: true },
    { key: "seller", header: "Seller", sortable: true },
    { key: "buyer", header: "Buyer", sortable: true },
    {
      key: "price",
      header: "Price",
      sortable: true,
      align: "right" as const,
      render: (r: SaleRow) => (typeof r.price === "number" ? r.price.toLocaleString() : String(r.price ?? "")),
    },
    {
      key: "removed_date",
      header: "Date",
      sortable: true,
      render: (r: SaleRow) => String(r.removed_date ?? ""),
    },
  ];

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-header-title">Pricing</h1>
          <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
            Recent sales from the pricing module.
          </p>
        </div>
        {canScrape && (
          <div className="page-header-actions">
            <Button disabled={scraping} onClick={runJob} ariaLabel="Run Pricing Scraper">
              {scraping ? "Scraping..." : "Run scraper job"}
            </Button>
          </div>
        )}
      </header>

      {error && (
        <div style={{ marginBottom: "var(--space-4)", padding: "var(--space-3)", background: "var(--tint-bad)", border: "1px solid var(--bad)", borderRadius: "var(--radius-sm)", color: "var(--text-strong)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r, idx) => r.item ? `${r.item}-${idx}` : String(idx)}
        ariaLabel="Recent game item sales and prices"
        emptyState="No sales tracked yet."
      />
    </div>
  );
}
