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

interface ResourceRow {
  character: string;
  account: string;
  prof: string;
  level: number;
  energy: string;
  weekly: number;
  total: number;
  suffused: number;
  favor: number;
  bonus: number;
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
  const [activeTab, setActiveTab] = useState<"bank" | "resources">("bank");
  const [rows, setRows] = useState<BankRow[]>([]);
  const [resRows, setResRows] = useState<ResourceRow[]>([]);
  const [resLoaded, setResLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRes, setLoadingRes] = useState(false);
  const [q, setQ] = useState("");
  const [account, setAccount] = useState("all");
  const [hiddenTowns, setHiddenTowns] = useState<string[]>([]);
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

  useEffect(() => {
    if (activeTab !== "resources" || resLoaded) return;
    (async () => {
      setLoadingRes(true);
      try {
        setResRows(await api<ResourceRow[]>("/modules/inventory/resources", auth));
        setError(null);
      } catch (err) {
        const msg = (err as Error).message;
        setError(msg);
        addToast({ tone: "bad", title: "Resources Data Failed", message: msg });
      } finally {
        setResLoaded(true);
        setLoadingRes(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, resLoaded, auth]);

  const { towns, displayRows } = useMemo(() => {
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
    return { towns, displayRows };
  }, [rows]);

  const accounts = useMemo(() => {
    const s = new Set<string>();
    for (const r of displayRows) s.add(r.account);
    for (const r of resRows) s.add(r.account);
    return [...s].sort();
  }, [displayRows, resRows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return displayRows.filter(
      (r) =>
        (needle === "" || r.character.toLowerCase().includes(needle)) &&
        (account === "all" || r.account === account),
    );
  }, [displayRows, q, account]);

  const filteredRes = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return resRows.filter(
      (r) =>
        (needle === "" || r.character.toLowerCase().includes(needle)) &&
        (account === "all" || r.account === account),
    );
  }, [resRows, q, account]);

  const grandTotal = filtered.reduce((s, r) => s + r.total, 0);

  const columns = useMemo<Column<DisplayRow>[]>(() => {
    const visibleTowns = towns.filter((t) => !hiddenTowns.includes(t));
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
      ...visibleTowns.map(
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
  }, [towns, hiddenTowns]);

  const resColumns = useMemo<Column<ResourceRow>[]>(
    () => [
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
      { key: "energy", header: "Energy", sortable: true },
      { key: "weekly", header: "Weekly", sortable: true, align: "right", render: (r) => fmt(r.weekly) },
      { key: "total", header: "Total", sortable: true, align: "right", render: (r) => fmt(r.total) },
      { key: "suffused", header: "Suffused", sortable: true, align: "right", render: (r) => fmt(r.suffused) },
      { key: "favor", header: "Favor", sortable: true, align: "right", render: (r) => fmt(r.favor) },
      { key: "bonus", header: "Bonus", sortable: true, align: "right", render: (r) => fmt(r.bonus) },
    ],
    [],
  );

  return (
    <div>
      <header className="page-header" style={{ flexDirection: "column" }}>
        <h1 className="page-header-title">Lookup</h1>
        <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
          Interactive view of everything invdb collects — bank balances, resources, then tickets, items.
        </p>
      </header>

      <Tabs
        tabs={[
          { id: "bank", label: "Bank" },
          { id: "resources", label: "Resources" },
          { id: "tickets", label: "Tickets", disabled: true },
          { id: "items", label: "Items", disabled: true },
        ]}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as "bank" | "resources")}
        ariaLabel="Lookup sections"
      />
      <p className="muted" style={{ margin: "var(--space-2) 0 var(--space-4) 0" }}>
        Tickets and Items arrive in steps 3–4; launch ▸ is wired in step 5.
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

      {activeTab === "bank" && (
        <div
          className="toolbar"
          style={{ flexWrap: "wrap", maxWidth: "960px", marginBottom: "var(--space-4)", rowGap: "var(--space-2)" }}
        >
          <span className="muted" style={{ marginRight: "var(--space-2)" }}>
            Towns:
          </span>
          {towns.map((t) => {
            const hidden = hiddenTowns.includes(t);
            return (
              <Button
                key={t}
                size="sm"
                variant={hidden ? "ghost" : "primary"}
                ariaPressed={!hidden}
                onClick={() => setHiddenTowns((h) => (hidden ? h.filter((x) => x !== t) : [...h, t]))}
                ariaLabel={`${hidden ? "Show" : "Hide"} ${TOWN_LABELS[t] ?? t}`}
                title={t}
              >
                {TOWN_LABELS[t] ?? t}
              </Button>
            );
          })}
          <Button size="sm" variant="ghost" onClick={() => setHiddenTowns([])} ariaLabel="Show all towns">
            All
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setHiddenTowns(towns)} ariaLabel="Hide all towns">
            None
          </Button>
        </div>
      )}

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

      {activeTab === "bank" ? (
        <>
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
        </>
      ) : (
        <>
          <Table
            columns={resColumns}
            rows={filteredRes}
            rowKey={(r) => String(r.character)}
            ariaLabel="Character resources"
            loading={loadingRes}
            emptyState="No resource data found (fewer characters have resources scanned)."
          />
          <p className="muted" style={{ marginTop: "var(--space-3)", textAlign: "right" }}>
            {filteredRes.length} {filteredRes.length === 1 ? "character" : "characters"} have resource data
          </p>
        </>
      )}
    </div>
  );
}
