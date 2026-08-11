import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";

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
      <h1>Dashboard</h1>
      <p className="muted">Live summaries from the platform backend.</p>
      <div className="tile-grid">
        {visible.map((t) => {
          const state = tiles[t.id];
          return (
            <Link to={t.path} key={t.id} className="tile panel">
              <div className="tile-icon">{t.icon}</div>
              <div className="tile-title">{t.title}</div>
              {!state ? (
                <div className="skeleton" aria-label="loading" />
              ) : state.error ? (
                <div className="tile-value error">{state.error}</div>
              ) : (
                <div className="tile-value">{state.value}</div>
              )}
            </Link>
          );
        })}
        {!visible.length && (
          <p className="muted">No scopes — sign in with a token that holds module scopes.</p>
        )}
      </div>
    </div>
  );
}
