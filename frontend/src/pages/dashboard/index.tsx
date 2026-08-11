import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import { Card, Skeleton } from "../../components";

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
];

interface TileState {
  value?: string;
  error?: string;
}

export default function Dashboard({ auth }: { auth: AuthState }) {
  const [tiles, setTiles] = useState<Record<string, TileState>>({});
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

  const visible = TILES.filter((t) => can(auth, [t.scope]));

  return (
    <div>
      <header className="page-header" style={{ flexDirection: "column" }}>
        <h1 className="page-header-title">Dashboard</h1>
        <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
          Live summaries from the platform backend.
        </p>
      </header>
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
