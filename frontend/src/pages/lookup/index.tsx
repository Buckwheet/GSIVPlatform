import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Select, Skeleton, Table, Tabs, useToast, type Column } from "../../components";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";

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

interface TicketRow {
  character: string;
  account: string;
  prof: string;
  level: number;
  source: string;
  amount: number;
  currency: string;
}

interface LumnisRow {
  character: string;
  account: string;
  prof: string;
  level: number;
  status: string;
  triple: number;
  double: number;
  total: number;
  start_day: string;
  start_time: string;
  last_schedule: string;
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

interface ItemRow {
  character: string;
  account: string;
  prof: string;
  level: number;
  loc: string;
  location: string;
  location_name: string;
  path: string;
  item: string;
  noun: string;
  type: string;
  amount: number;
  stack: string;
  status: string;
  marked: string;
  registered: string;
  worn: string;
  hidden: string;
  timestamp: number;
}

interface OverviewChar {
  character: string;
  account: string;
  prof: string;
  level: number;
  race: string;
  totalSilver: number;
  itemCount: number;
  resourceTotal: number | null;
  energy: string | null;
  lumnisTotal: number | null;
  lumnisStatus: string | null;
  ticketCount: number;
  lastScan: number | null;
}

interface OverviewPayload {
  stats: {
    characters: number;
    accounts: number;
    items: number;
    totalSilver: number;
    dataAsOf: string | null;
    tableFreshness: { table: string; asOf: string | null; daysOld: number | null }[];
  };
  perCharacter: OverviewChar[];
  distributions: {
    itemTypes: { label: string; count: number }[];
    itemLocations: { label: string; count: number }[];
    townBanks: { label: string; amount: number }[];
    richest: { character: string; totalSilver: number }[];
    topHoards: { character: string; itemCount: number }[];
  };
  notices: { level: "info" | "warn"; message: string }[];
}

/** Per-char VellumFE stream links from the gameview module (scope gameview.read). */
interface StreamMap {
  [char: string]: { url: string; up: boolean };
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

/** One-click invdb filter expression starters for the Items tab. */
const ITEM_EXAMPLES = [
  "type=gem",
  "type=weapon",
  "status=empty",
  "amount>1",
  "location=locker",
  "marked=Y",
  "/duskruin/",
  "type=gem amount>5",
];

const fmt = (n: number) => n.toLocaleString("en-US");

export default function Lookup({ auth }: { auth: AuthState }) {
  const [activeTab, setActiveTab] = useState<"overview" | "bank" | "resources" | "tickets" | "items">("overview");
  const [rows, setRows] = useState<BankRow[]>([]);
  const [resRows, setResRows] = useState<ResourceRow[]>([]);
  const [resLoaded, setResLoaded] = useState(false);
  const [tktRows, setTktRows] = useState<TicketRow[]>([]);
  const [lumRows, setLumRows] = useState<LumnisRow[]>([]);
  const [tktLoaded, setTktLoaded] = useState(false);
  const [loadingTkt, setLoadingTkt] = useState(false);
  const [itemRows, setItemRows] = useState<ItemRow[]>([]);
  const [itemLoaded, setItemLoaded] = useState(false);
  const [itemLoading, setItemLoading] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [overviewLoaded, setOverviewLoaded] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [expr, setExpr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRes, setLoadingRes] = useState(false);
  const [q, setQ] = useState("");
  const [account, setAccount] = useState("all");
  const [hiddenTowns, setHiddenTowns] = useState<string[]>([]);
  const [streams, setStreams] = useState<StreamMap>({});
  const [launching, setLaunching] = useState<string | null>(null);
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
    // Stream links come from the gameview module (needs gameview.read). Without
    // the scope, launch ▸ stays disabled — the rest of the page still works.
    api<StreamMap>("/modules/gameview/streams", auth)
      .then(setStreams)
      .catch(() => setStreams({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  useEffect(() => {
    if (activeTab !== "tickets" || tktLoaded) return;
    (async () => {
      setLoadingTkt(true);
      try {
        const [t, l] = await Promise.all([
          api<TicketRow[]>("/modules/inventory/tickets", auth),
          api<LumnisRow[]>("/modules/inventory/lumnis", auth),
        ]);
        setTktRows(t);
        setLumRows(l);
        setError(null);
      } catch (err) {
        const msg = (err as Error).message;
        setError(msg);
        addToast({ tone: "bad", title: "Tickets Data Failed", message: msg });
      } finally {
        setTktLoaded(true);
        setLoadingTkt(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, tktLoaded, auth]);

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

  // Overview: lazy-load once on first activation (it is the default tab, so on mount).
  useEffect(() => {
    if (activeTab !== "overview" || overviewLoaded) return;
    (async () => {
      setOverviewLoading(true);
      try {
        setOverview(await api<OverviewPayload>("/modules/inventory/overview", auth));
        setError(null);
      } catch (err) {
        const msg = (err as Error).message;
        setOverviewError(msg);
        addToast({ tone: "bad", title: "Overview Data Failed", message: msg });
      } finally {
        setOverviewLoaded(true);
        setOverviewLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, overviewLoaded, auth]);

  // Items: lazy-load once on tab activation (empty expression = browse everything),
  // then re-run on every explicit search.
  useEffect(() => {
    if (activeTab !== "items" || itemLoaded) return;
    runItemSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, itemLoaded, auth]);

  async function runItemSearch(expression: string) {
    setItemLoading(true);
    setItemError(null);
    try {
      const filter = expression.trim();
      const path = `/modules/inventory/search${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`;
      const results = await api<ItemRow[]>(path, auth);
      setItemRows(results);
      setError(null);
    } catch (err) {
      const msg = (err as Error).message;
      setItemError(msg);
      addToast({ tone: "bad", title: "Item Search Failed", message: msg });
    } finally {
      setItemLoading(false);
      setItemLoaded(true);
    }
  }

  /**
   * launch ▸ — one click brings the char online and opens its stream (step 5b):
   * POST /launch/:char starts the char's Lich unit when it is inactive, then
   * the stream tab opens (zero-click auto-connect). Only stream-configured
   * chars can launch; without a write scope it falls back to the step-5
   * behavior (open the live stream when up, explain otherwise).
   */
  async function launchChar(character: string, url: string, streamUp: boolean) {
    setLaunching(character);
    // Open the tab inside the click gesture (popup blockers eat window.open
    // after an await); navigate it once the backend confirms the start.
    const win = window.open("about:blank", "_blank");
    try {
      const res = await api<{ char: string; url: string; started: boolean }>(
        `/modules/gameview/launch/${encodeURIComponent(character)}`,
        auth,
        { method: "POST" },
      );
      if (win) win.location.href = res.url;
      addToast({
        tone: "good",
        title: `${character} launched`,
        message: `${res.started ? "Lich session started" : "Lich session already active"} — ${streamUp ? "stream opened." : "stream web UI is currently offline."}`,
      });
    } catch (err) {
      if (win) win.close();
      addToast({ tone: "bad", title: `Launch ${character} failed`, message: (err as Error).message });
    } finally {
      setLaunching(null);
    }
  }

  function renderLaunch(character: string) {
    const s = streams[character];
    const canWrite = can(auth, ["lich.write"]) || can(auth, ["characters.write"]);
    if (!s) {
      return (
        <Button
          disabled
          title={`No stream for ${character} — add one per deploy/V2-DEPLOYMENT.md §VellumFE`}
          ariaLabel={`Launch ${character}`}
        >
          launch ▸
        </Button>
      );
    }
    if (canWrite) {
      return (
        <Button
          loading={launching === character}
          onClick={() => void launchChar(character, s.url, s.up)}
          title={`Bring ${character} online and open the stream`}
          ariaLabel={`Bring ${character} online and open stream`}
        >
          launch ▸
        </Button>
      );
    }
    if (s.up) {
      return (
        <a
          className="gs-btn gs-btn--ghost gs-btn--sm"
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open live stream for ${character}`}
        >
          launch ▸
        </a>
      );
    }
    return (
      <Button disabled title={`${character} stream is offline`} ariaLabel={`Launch ${character}`}>
        launch ▸
      </Button>
    );
  }

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
    for (const r of tktRows) s.add(r.account);
    for (const r of lumRows) s.add(r.account);
    for (const r of itemRows) s.add(r.account);
    for (const r of overview?.perCharacter ?? []) s.add(r.account);
    return [...s].sort();
  }, [displayRows, resRows, itemRows, overview]);

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

  const filteredTkt = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tktRows.filter(
      (r) =>
        (needle === "" || r.character.toLowerCase().includes(needle)) &&
        (account === "all" || r.account === account),
    );
  }, [tktRows, q, account]);

  const filteredLum = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lumRows.filter(
      (r) =>
        (needle === "" || r.character.toLowerCase().includes(needle)) &&
        (account === "all" || r.account === account),
    );
  }, [lumRows, q, account]);

  const filteredItems = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return itemRows.filter(
      (r) =>
        (needle === "" || r.character.toLowerCase().includes(needle)) &&
        (account === "all" || r.account === account),
    );
  }, [itemRows, q, account]);

  const filteredOverview = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (overview?.perCharacter ?? []).filter(
      (r) =>
        (needle === "" || r.character.toLowerCase().includes(needle)) &&
        (account === "all" || r.account === account),
    );
  }, [overview, q, account]);

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
        render: (r) => renderLaunch(r.character),
      },
    ];
    return cols;
  }, [towns, hiddenTowns, streams, launching, auth]);

  const charCol = (r: { account: string; character: string; level: number; prof: string }) => (
    <div>
      <div>{r.character}</div>
      <div className="muted" style={{ fontSize: "0.85em" }}>
        {r.account} · L{r.level} {r.prof}
      </div>
    </div>
  );

  const tktColumns = useMemo<Column<TicketRow>[]>(
    () => [
      { key: "character", header: "Character", sortable: true, render: charCol },
      { key: "source", header: "Source", sortable: true },
      { key: "amount", header: "Amount", sortable: true, align: "right", render: (r) => fmt(r.amount) },
      { key: "currency", header: "Currency", sortable: true },
    ],
    [],
  );

  const lumColumns = useMemo<Column<LumnisRow>[]>(
    () => [
      { key: "character", header: "Character", sortable: true, render: charCol },
      { key: "status", header: "Status", sortable: true },
      { key: "triple", header: "Triple", sortable: true, align: "right", render: (r) => fmt(r.triple) },
      { key: "double", header: "Double", sortable: true, align: "right", render: (r) => fmt(r.double) },
      { key: "total", header: "Total", sortable: true, align: "right", render: (r) => fmt(r.total) },
      { key: "start_day", header: "Start Day", sortable: true },
      { key: "start_time", header: "Start Time", sortable: true },
      { key: "last_schedule", header: "Last Schedule", sortable: true },
    ],
    [],
  );

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

  const itemColumns = useMemo<Column<ItemRow>[]>(
    () => [
      { key: "character", header: "Character", sortable: true, render: charCol },
      {
        key: "loc",
        header: "Location",
        sortable: true,
        render: (r) => (
          <span title={`${r.location_name}${r.path ? ` — inside ${r.path}` : ""}`}>{r.loc || "–"}</span>
        ),
      },
      {
        key: "item",
        header: "Item",
        sortable: true,
        render: (r) => (
          <div>
            <div>{r.item}</div>
            <div className="muted" style={{ fontSize: "0.85em" }}>
              {r.noun || "–"}
              {r.path ? ` · in ${r.path}` : ""}
            </div>
          </div>
        ),
      },
      { key: "type", header: "Type", sortable: true },
      { key: "amount", header: "Qty", sortable: true, align: "right", render: (r) => fmt(r.amount) },
      { key: "stack", header: "Stack", sortable: true, render: (r) => r.stack || "–" },
      { key: "status", header: "Status", sortable: true, render: (r) => r.status || "–" },
      { key: "marked", header: "Marked", sortable: true, render: (r) => r.marked || "–" },
      {
        key: "launch",
        header: "",
        align: "right",
        render: (r) => renderLaunch(r.character),
      },
    ],
    [streams, launching, auth],
  );

  const relAgo = (sec: number) => {
    if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  };

  const statValues = overview
    ? [
        { label: "Characters", value: fmt(overview.stats.characters) },
        { label: "Items tracked", value: fmt(overview.stats.items) },
        { label: "Silvers in town banks", value: fmt(overview.stats.totalSilver) },
        { label: "Accounts", value: fmt(overview.stats.accounts) },
        {
          label: "Data as of",
          value: overview.stats.dataAsOf
            ? relAgo(Math.floor((Date.now() - Date.parse(overview.stats.dataAsOf)) / 1000))
            : "no scans yet",
        },
      ]
    : [];

  const overviewColumns = useMemo<Column<OverviewChar>[]>(
    () => [
      { key: "character", header: "Character", sortable: true, render: charCol },
      { key: "level", header: "Level", sortable: true, align: "right" },
      { key: "itemCount", header: "Items", sortable: true, align: "right", render: (r) => fmt(r.itemCount) },
      { key: "totalSilver", header: "Silvers", sortable: true, align: "right", render: (r) => fmt(r.totalSilver) },
      {
        key: "resourceTotal",
        header: "Resources",
        sortable: true,
        align: "right",
        render: (r) => (r.resourceTotal === null ? "–" : fmt(r.resourceTotal)),
      },
      {
        key: "lumnisTotal",
        header: "Lumnis",
        sortable: true,
        align: "right",
        render: (r) => (r.lumnisTotal === null ? "–" : fmt(r.lumnisTotal)),
      },
      { key: "ticketCount", header: "Tickets", sortable: true, align: "right", render: (r) => fmt(r.ticketCount) },
      {
        key: "lastScan",
        header: "Last scan",
        sortable: true,
        render: (r) => (r.lastScan === null ? "–" : relAgo(Math.floor(Date.now() / 1000) - r.lastScan)),
      },
      { key: "launch", header: "", align: "right", render: (r) => renderLaunch(r.character) },
    ],
    [streams, launching, auth],
  );

  return (
    <div>
      <header className="page-header" style={{ flexDirection: "column" }}>
        <h1 className="page-header-title">Lookup</h1>
        <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
          Interactive view of everything invdb collects — bank balances, resources, tickets, items.
        </p>
      </header>

      <Tabs
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "bank", label: "Bank" },
          { id: "resources", label: "Resources" },
          { id: "tickets", label: "Tickets" },
          { id: "items", label: "Items" },
        ]}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as "overview" | "bank" | "resources" | "tickets" | "items")}
        ariaLabel="Lookup sections"
      />
      <p className="muted" style={{ margin: "var(--space-2) 0 var(--space-4) 0" }}>
        launch ▸ brings the character online (starts its Lich session when needed) and opens its stream in a new tab (currently Fisternar, Neleourg).
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

      {activeTab === "items" && (
        <div style={{ maxWidth: "960px", marginBottom: "var(--space-4)" }}>
          <div className="toolbar">
            <Input
              id="lookupItemsExpr"
              label="invdb filter expression"
              placeholder="e.g. sword  type=weapon  amount>1  location=locker  status!=empty  /duskruin/"
              value={expr}
              onChange={setExpr}
              className="search-input"
              onKeyDown={(e) => {
                if (e.key === "Enter") void runItemSearch(expr);
              }}
            />
            <Button onClick={() => void runItemSearch(expr)} loading={itemLoading} ariaLabel="Run item search">
              Search
            </Button>
          </div>
          <div className="toolbar" style={{ flexWrap: "wrap", marginTop: "var(--space-2)", rowGap: "var(--space-2)" }}>
            <span className="muted" style={{ marginRight: "var(--space-2)" }}>
              Examples:
            </span>
            {ITEM_EXAMPLES.map((ex) => (
              <Button
                key={ex}
                size="sm"
                variant="ghost"
                onClick={() => {
                  setExpr(ex);
                  void runItemSearch(ex);
                }}
                ariaLabel={`Search ${ex}`}
                title={ex}
              >
                {ex}
              </Button>
            ))}
          </div>
          <p className="muted" style={{ margin: "var(--space-2) 0 0 0", fontSize: "0.9em" }}>
            Bare words match item names. Filters: <code>type=gem</code> <code>location=inv|locker</code>{" "}
            <code>amount&gt;2</code> <code>level&gt;90</code> <code>status!=empty</code> <code>marked=Y</code>{" "}
            <code>name=/regex/i</code> <code>*</code> wildcards, <code>|</code>/<code>,</code> arrays,{" "}
            <code>limit=N</code>, <code>orderby=-amount</code>.
          </p>
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

      {activeTab === "overview" ? (
        <>
          {overviewError && (
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
              <strong>Overview error:</strong> {overviewError}
            </div>
          )}
          {overviewLoading && !overview && <Skeleton variant="text" lines={4} />}
          {overview && (
            <>
              {overview.notices.length > 0 && (
                <div style={{ marginBottom: "var(--space-4)" }}>
                  {overview.notices.map((n, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: "var(--control-gap)",
                        alignItems: "flex-start",
                        padding: "var(--space-2) var(--space-3)",
                        marginBottom: "var(--space-2)",
                        borderRadius: "var(--radius-sm)",
                        background: n.level === "warn" ? "var(--tint-warn)" : "var(--panel)",
                        border: `1px solid ${n.level === "warn" ? "var(--warn)" : "var(--border)"}`,
                        color: "var(--text-strong)",
                        fontSize: "var(--font-size-sm)",
                      }}
                    >
                      <span aria-hidden>{n.level === "warn" ? "⚠️" : "ℹ️"}</span>
                      <span>{n.message}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="tile-grid" style={{ marginTop: 0 }}>
                {statValues.map((s) => (
                  <Card key={s.label} ariaLabel={s.label} title={s.label}>
                    <span style={{ fontSize: "var(--font-size-xl)", fontWeight: "var(--font-weight-bold)" }}>
                      {s.value}
                    </span>
                  </Card>
                ))}
              </div>

              <div className="tile-grid" style={{ marginTop: "var(--space-4)" }}>
                {[
                  {
                    title: "Item types (top)",
                    rows: overview.distributions.itemTypes.map((d) => ({ label: d.label, value: fmt(d.count) })),
                  },
                  {
                    title: "Item locations (top)",
                    rows: overview.distributions.itemLocations.map((d) => ({ label: d.label, value: fmt(d.count) })),
                  },
                  {
                    title: "Town bank silvers (top)",
                    rows: overview.distributions.townBanks.map((d) => ({ label: d.label, value: fmt(d.amount) })),
                  },
                  {
                    title: "Richest characters",
                    rows: overview.distributions.richest.map((d) => ({ label: d.character, value: fmt(d.totalSilver) })),
                  },
                  {
                    title: "Largest inventories",
                    rows: overview.distributions.topHoards.map((d) => ({ label: d.character, value: fmt(d.itemCount) })),
                  },
                ].map((list) => (
                  <Card key={list.title} title={list.title} padding="compact" ariaLabel={list.title}>
                    {list.rows.length === 0 && <p className="muted" style={{ margin: 0 }}>No data.</p>}
                    {list.rows.map((r) => (
                      <div
                        key={r.label}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "var(--control-gap)",
                          padding: "var(--space-1) 0",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.label}
                        </span>
                        <span className="muted">{r.value}</span>
                      </div>
                    ))}
                  </Card>
                ))}
              </div>

              <h2
                className="page-header-title"
                style={{ fontSize: "var(--font-size-lg)", margin: "var(--space-5) 0 var(--space-2) 0" }}
              >
                All characters
              </h2>
              <Table
                columns={overviewColumns}
                rows={filteredOverview}
                rowKey={(r) => String(r.character)}
                ariaLabel="Unified per-character overview"
                loading={overviewLoading}
                emptyState="No character data found (invdb may not be scanned on this backend)."
              />
              <p className="muted" style={{ marginTop: "var(--space-3)", textAlign: "right" }}>
                {filteredOverview.length} {filteredOverview.length === 1 ? "character" : "characters"} · grand total{" "}
                <strong>{fmt(overview.stats.totalSilver)}</strong> silvers
              </p>
            </>
          )}
        </>
      ) : activeTab === "bank" ? (
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
      ) : activeTab === "resources" ? (
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
      ) : activeTab === "items" ? (
        <>
          {itemError && (
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
              <strong>Search error:</strong> {itemError}
            </div>
          )}
          <Table
            columns={itemColumns}
            rows={filteredItems}
            rowKey={(r) => `${r.character}-${r.item}-${r.loc}-${r.path}-${r.timestamp}`}
            ariaLabel="Item search results"
            loading={itemLoading}
            emptyState="No items match — try fewer or different filters."
          />
          <p className="muted" style={{ marginTop: "var(--space-3)", textAlign: "right" }}>
            {filteredItems.length} {filteredItems.length === 1 ? "result" : "results"}
            {filteredItems.length === 500 ? " · showing the first 500 — narrow your search with filters" : ""}
          </p>
        </>
      ) : (
        <>
          <h2 className="page-header-title" style={{ fontSize: "var(--font-size-lg)", margin: "0 0 var(--space-2) 0" }}>
            Tickets
          </h2>
          <Table
            columns={tktColumns}
            rows={filteredTkt}
            rowKey={(r) => `${r.character}-${r.source}`}
            ariaLabel="Character tickets"
            loading={loadingTkt}
            emptyState="No ticket data found."
          />
          <p className="muted" style={{ marginTop: "var(--space-2)", textAlign: "right" }}>
            {filteredTkt.length} {filteredTkt.length === 1 ? "entry" : "entries"}
          </p>

          <h2 className="page-header-title" style={{ fontSize: "var(--font-size-lg)", margin: "var(--space-5) 0 var(--space-2) 0" }}>
            Lumnis
          </h2>
          <Table
            columns={lumColumns}
            rows={filteredLum}
            rowKey={(r) => String(r.character)}
            ariaLabel="Character lumnis status"
            loading={loadingTkt}
            emptyState="No lumnis data found."
          />
          <p className="muted" style={{ marginTop: "var(--space-2)", textAlign: "right" }}>
            {filteredLum.length} {filteredLum.length === 1 ? "character" : "characters"} have lumnis data
          </p>
        </>
      )}
    </div>
  );
}
