import { useEffect, useMemo, useState } from "react";
import { Button, Input, Select, Table, Tabs, useToast, type Column } from "../../components";
import { api } from "../../core/api";
import type { AuthState } from "../../core/auth";

interface BankRow {
  character: string;
  account: string;
  prof: string;
  level: number;
  bank: string;
  silvers: number;
}

interface DisplayRow {
  character: string;
  account: string;
  prof: string;
  level: number;
  total: number;
  launch: "";
  // town bank name -> silvers; -1 when the char has no recorded row for it
  [town: string]: string | number;
}

/** Short header labels for the 10 town banks (full name on hover). */
const TOWN_LABELS: Record<string, string> = {
  "First Elanith Secured Bank": "First Elanith",
  "Vornavis Bank of Solhaven": "Solhaven",
  "Icemule Trace Bank": "Icemule",
  "United City-States Bank": "City-States",
  "Bank of Kharag 'doth Dzulthu": "Kharag",
  "Four Winds Bank": "Four Winds",
  "Great Bank of Kharam-Dzu": "Kharam-Dzu",
  "Bank of Torre County": "Torre",
  "Cysaegir Bank": "Cysaegir",
  "Kraken's Fall Bank": "Kraken's Fall",
};

const fmt = (n: number) => n.toLocaleString("en-US");

export default function Lookup({ auth }: { auth: AuthState }) {
  const [rows, setRows] = useState<BankRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [account, setAccount] = useState("all");
  const { addToast } = useToast();

  useEffect(() => {
    (async () => {
      try {
        setRows(await api<BankRow[]>("/modules/inventory/bank", auth));
        setError(null);
      } catch (err) {
        const msg = (err as Error).message;
        setError(msg);
        addToast({ tone: "bad", title: "Bank Data Failed", message: msg });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  const { towns, displayRows, accounts } = useMemo(() => {
    const towns: string[] = [];
    const byChar = new Map<
      string,
      { account: string; prof: string; level: number; total: number; amounts: Map<string, number> }
    >();
    for (const r of rows) {
      if (!byChar.has(r.character)) {
        byChar.set(r.character, { account: r.account, prof: r.prof, level: r.level, total: 0, amounts: new Map() });
      }
      const c = byChar.get(r.character)!;
      if (r.bank === "Total") {
        // Stored Total is authoritative (can include amounts beyond the town rows).
        c.total = r.silvers;
      } else {
        if (!towns.includes(r.bank)) towns.push(r.bank);
        c.amounts.set(r.bank, r.silvers);
      }
    }
    const displayRows: DisplayRow[] = [...byChar.entries()].map(([name, c]) => {
      const total = c.total > 0 ? c.total : [...c.amounts.values()].reduce((a, b) => a + b, 0);
      const row: DisplayRow = { character: name, account: c.account, prof: c.prof, level: c.level, total, launch: "" };
      for (const t of towns) row[t] = c.amounts.get(t) ?? -1;
      return row;
    });
    const accounts = [...new Set(displayRows.map((r) => r.account))].sort();
    return { towns, displayRows, accounts };
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return displayRows.filter(
      (r) =>
        (needle === "" || r.character.toLowerCase().includes(needle)) &&
        (account === "all" || r.account === account),
    );
  }, [displayRows, q, account]);

  const grandTotal = filtered.reduce((s, r) => s + r.total, 0);

  const columns = useMemo<Column<DisplayRow>[]>(() => {
    const cols: Column<DisplayRow>[] = [
      {
        key: "character",
        header: "Character",
        sortable: true,
        render: (r) => (
          <div>
            <div>{r.character}</div>
            <div className="muted" style={{ fontSize: "0.85em" }}>
              {r.account} · L{r.level} {r.prof}
            </div>
          </div>
        ),
      },
      ...towns.map(
        (town) =>
          ({
            key: town,
            header: <span title={town}>{TOWN_LABELS[town] ?? town}</span>,
            sortable: true,
            align: "right",
            render: (r: DisplayRow) => (r[town] === -1 ? "–" : fmt(r[town] as number)),
          }) satisfies Column<DisplayRow>,
      ),
      {
        key: "total",
        header: "Total",
        sortable: true,
        align: "right",
        render: (r) => <strong>{fmt(r.total)}</strong>,
      },
      {
        key: "launch",
        header: "",
        align: "right",
        render: (r) => (
          <Button disabled title="Wired in step 5 (launch-a-character)" ariaLabel={`Launch ${r.character}`}>
            launch ▸
          </Button>
        ),
      },
    ];
    return cols;
  }, [towns]);

  return (
    <div>
      <header className="page-header" style={{ flexDirection: "column" }}>
        <h1 className="page-header-title">Lookup</h1>
        <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
          Interactive view of everything invdb collects — bank balances first (step 1), then resources, tickets, items.
        </p>
      </header>

      <Tabs
        tabs={[
          { id: "bank", label: "Bank" },
          { id: "resources", label: "Resources", disabled: true },
          { id: "tickets", label: "Tickets", disabled: true },
          { id: "items", label: "Items", disabled: true },
        ]}
        activeId="bank"
        onChange={() => undefined}
        ariaLabel="Lookup sections"
      />
      <p className="muted" style={{ margin: "var(--space-2) 0 var(--space-4) 0" }}>
        Resources, Tickets and Items arrive in steps 2–4; launch ▸ is wired in step 5.
      </p>

      <div className="toolbar" style={{ maxWidth: "640px", marginBottom: "var(--space-4)" }}>
        <Input id="lookupChar" placeholder="filter by character…" value={q} onChange={setQ} className="search-input" />
        <Select
          id="lookupAccount"
          label=""
          value={account}
          onChange={setAccount}
          options={[{ value: "all", label: "All accounts" }, ...accounts.map((a) => ({ value: a, label: a }))]}
        />
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
        rows={filtered}
        rowKey={(r) => String(r.character)}
        ariaLabel="Bank silvers per character"
        loading={loading}
        emptyState="No bank data found (invdb may not be scanned on this backend)."
      />

      <p className="muted" style={{ marginTop: "var(--space-3)", textAlign: "right" }}>
        {filtered.length} {filtered.length === 1 ? "character" : "characters"} · Grand total:{" "}
        <strong>{fmt(grandTotal)}</strong> silvers
      </p>
    </div>
  );
}
