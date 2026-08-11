import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import { Card, Skeleton, StatusDot } from "../../components";

interface TileDef {
  id: string;
  title: string;
  icon: string;
  path: string;
  scope: string;
  fetch: (auth: AuthState) => Promise<string>;
}

const TILES: TileDef[] = [
  {
    id: "characters",
    title: "Characters",
    icon: "🧝",
    path: "/characters",
    scope: "characters.read",
    fetch: async (a) => {
      const rows = await api<{ active: boolean }[]>("/modules/characters/characters", a);
      const active = rows.filter((r) => r.active).length;
      return `${active}/${rows.length} online`;
    },
  },
  {
    id: "jars",
    title: "Jars",
    icon: "🫙",
    path: "/jars",
    scope: "gems.read",
    fetch: async (a) => {
      const jars = await api<{ full_jar_count: number }[]>("/modules/gems/jars", a);
      const total = jars.reduce((n, j) => n + (j.full_jar_count ?? 0), 0);
      return `${jars.length} characters · ${total} full jars`;
    },
  },
  {
    id: "healer",
    title: "Healer",
    icon: "⛑️",
    path: "/healer",
    scope: "healer.read",
    fetch: async (a) => {
      const status = await api<{ pending: number; healers: unknown[] }>("/modules/healer/status", a);
      return `${status.pending} pending · ${status.healers.length} healers`;
    },
  },
  {
    id: "accounts",
    title: "Accounts",
    icon: "👥",
    path: "/accounts",
    scope: "accounts.read",
    fetch: async (a) => {
      const list = await api<{ accounts: unknown[] }>("/modules/accounts/accounts", a);
      return `${list.accounts.length} scanned`;
    },
  },
  {
    id: "your-shops",
    title: "Your Shops",
    icon: "🏪",
    path: "/your-shops",
    scope: "yourshops.read",
    fetch: async (a) => {
      const res = await api<{ total: number; sales: { removed_date: string; cost: number | null }[] }>("/modules/your-shops/sales", a);
      const weekAgo = Date.now() - 7 * 86400_000;
      const week = res.sales.filter((s) => new Date(s.removed_date).getTime() >= weekAgo);
      const revenue = week.reduce((n, s) => n + (s.cost ?? 0), 0);
      return `${week.length} sales · ${revenue.toLocaleString()} this week`;
    },
  },
];

interface TileState {
  value?: string;
  error?: string;
}

export default function Dashboard({ auth }: { auth: AuthState }) {
  const [tiles, setTiles] = useState<Record<string, TileState>>({});
  const [online, setOnline] = useState<{ name: string; url?: string }[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  const canLive = can(auth, ["characters.read"]) && can(auth, ["gameview.read"]);
  const navigate = useNavigate();

  useEffect(() => {
    for (const t of TILES) {
      if (!can(auth, [t.scope])) continue;
      setTiles((prev) => ({ ...prev, [t.id]: {} }));
      void t
        .fetch(auth)
        .then((value) => setTiles((prev) => ({ ...prev, [t.id]: { value } })))
        .catch((err: Error) => setTiles((prev) => ({ ...prev, [t.id]: { error: err.message } })));
    }
  }, [auth]);

  // Who is logged in + their live stream link (Game View).
  useEffect(() => {
    if (!canLive) return;
    async function refreshLive() {
      try {
        const [chars, streams] = await Promise.all([
          api<{ char_name: string; active: boolean }[]>("/modules/characters/characters", auth),
          api<Record<string, { url: string; up: boolean }>>("/modules/gameview/streams", auth),
        ]);
        setOnline(
          chars
            .filter((c) => c.active)
            .map((c) => ({ name: c.char_name, url: streams[c.char_name]?.up ? streams[c.char_name].url : undefined })),
        );
        setLiveError(null);
      } catch (err) {
        setLiveError((err as Error).message);
      }
    }
    void refreshLive();
    const t = setInterval(() => void refreshLive(), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, canLive]);

  const visible = TILES.filter((t) => can(auth, [t.scope]));

  return (
    <div>
      <header className="page-header" style={{ flexDirection: "column" }}>
        <h1 className="page-header-title">Dashboard</h1>
        <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
          Live summaries from the platform backend.
        </p>
      </header>
      {canLive && (
        <Card
          ariaLabel="Live streams"
          title={
            <div style={{ display: "flex", alignItems: "center", gap: "var(--control-gap)" }}>
              <span style={{ fontSize: "var(--font-size-xl)" }}>📺</span>
              <span>Live Streams</span>
              <span className="muted" style={{ fontWeight: "var(--font-weight-normal)" }}>
                {online.length > 0 ? `${online.length} online` : "none online"}
              </span>
            </div>
          }
        >
          {liveError && (
            <p className="error" style={{ fontSize: "var(--font-size-sm)", margin: "var(--space-2) 0 0 0" }}>
              {liveError}
            </p>
          )}
          {!liveError && online.length === 0 && (
            <p className="muted" style={{ margin: "var(--space-2) 0 0 0" }}>No characters logged in right now.</p>
          )}
          {online.map((c) => (
            <a
              key={c.name}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={c.url ? `Watch ${c.name}'s stream` : `${c.name} online, no stream`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--control-gap)",
                padding: "var(--space-2) 0",
                borderBottom: "1px solid var(--border)",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "var(--control-gap)" }}>
                <StatusDot color="good" label="online" />
                <span style={{ fontWeight: "var(--font-weight-bold)" }}>{c.name}</span>
              </span>
              {c.url ? (
                <span className="gs-btn gs-btn--ghost gs-btn--sm">Watch ▸</span>
              ) : (
                <span className="muted" style={{ fontSize: "var(--font-size-sm)" }}>no stream</span>
              )}
            </a>
          ))}
        </Card>
      )}
      <div className="tile-grid">
        {visible.map((t) => {
          const state = tiles[t.id];
          const hasData = state && (state.value !== undefined || state.error !== undefined);
          return (
            <Card
              key={t.id}
              interactive
              onClick={() => navigate(t.path)}
              ariaLabel={`Go to ${t.title}`}
              title={
                <div style={{ display: "flex", alignItems: "center", gap: "var(--control-gap)" }}>
                  <span style={{ fontSize: "var(--font-size-xl)" }}>{t.icon}</span>
                  <span>{t.title}</span>
                </div>
              }
            >
              {!hasData ? (
                <Skeleton variant="text" lines={1} height={16} style={{ marginTop: "var(--space-2)" }} />
              ) : state.error ? (
                <span className="error" style={{ fontSize: "var(--font-size-sm)" }}>
                  {state.error}
                </span>
              ) : (
                <span style={{ fontSize: "var(--font-size-md)", fontWeight: "var(--font-weight-bold)" }}>
                  {state.value}
                </span>
              )}
            </Card>
          );
        })}
        {!visible.length && (
          <Card ariaLabel="No scopes card">
            <p className="muted" style={{ margin: 0 }}>
              No scopes — sign in with a token that holds module scopes.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
