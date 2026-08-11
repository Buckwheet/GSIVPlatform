import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import type { CharacterRow } from "../../core/types";
import { Table, StatusDot, Button, useToast } from "../../components";

const POLL_MS = 15_000; // polling fallback (ws-data-pattern.md §8) until the WS layer lands

export default function Characters({ auth }: { auth: AuthState }) {
  const [rows, setRows] = useState<CharacterRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [streams, setStreams] = useState<Record<string, { url: string; up: boolean }>>({});
  const canWatch = can(auth, ["gameview.read"]);
  const { addToast } = useToast();
  const write = can(auth, ["characters.write"]);

  async function refresh() {
    try {
      const [chars, streamMap] = await Promise.all([
        api<CharacterRow[]>("/modules/characters/characters", auth),
        canWatch ? api<Record<string, { url: string; up: boolean }>>("/modules/gameview/streams", auth) : Promise.resolve({}),
      ]);
      setRows(chars);
      setStreams(streamMap);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  async function act(name: string, action: "start" | "stop" | "restart") {
    setBusy(name);
    try {
      await api<{ ok: boolean }>(`/modules/characters/characters/${encodeURIComponent(name)}/${action}`, auth, { method: "POST" });
      addToast({
        tone: "good",
        title: `Lich Session ${action}ed`,
        message: `Successfully sent ${action} command for character ${name}.`,
      });
      await refresh();
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      addToast({
        tone: "bad",
        title: `Failed to ${action} Character`,
        message: msg,
      });
    } finally {
      setBusy(null);
    }
  }

  const columns = [
    { key: "char_name", header: "Name", sortable: true },
    {
      key: "active",
      header: "Status",
      sortable: true,
      render: (r: CharacterRow) => (
        <StatusDot
          color={r.active ? "good" : "neutral"}
          label={r.active ? "online" : "offline"}
        />
      ),
    },
    { key: "sub", header: "Sub", sortable: true },
    {
      key: "uptime",
      header: "Uptime",
      sortable: true,
      render: (r: CharacterRow) => (r.uptime != null ? `${Math.round(r.uptime / 60)}m` : "—"),
    },
    {
      key: "managed",
      header: "Managed",
      sortable: true,
      render: (r: CharacterRow) => (r.managed ? "yes" : "no"),
    },
    {
      key: "watch",
      header: "Stream",
      render: (r: CharacterRow) => {
        const stream = streams[r.char_name];
        if (!stream?.up) return <span className="muted">—</span>;
        return (
          <a
            className="gs-btn gs-btn--ghost gs-btn--sm"
            href={stream.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open live stream for ${r.char_name}`}
          >
            Watch
          </a>
        );
      },
    },
    ...(write
      ? [
          {
            key: "actions",
            header: "Actions",
            render: (r: CharacterRow) => (
              <div className="row-actions">
                <Button
                  size="sm"
                  disabled={busy === r.char_name || r.active}
                  onClick={() => act(r.char_name, "start")}
                  ariaLabel={`Start session for ${r.char_name}`}
                >
                  Start
                </Button>
                <Button
                  size="sm"
                  disabled={busy === r.char_name || !r.active}
                  onClick={() => act(r.char_name, "stop")}
                  ariaLabel={`Stop session for ${r.char_name}`}
                >
                  Stop
                </Button>
                <Button
                  size="sm"
                  disabled={busy === r.char_name || !r.active}
                  onClick={() => act(r.char_name, "restart")}
                  ariaLabel={`Restart session for ${r.char_name}`}
                >
                  Restart
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <header className="page-header" style={{ flexDirection: "column" }}>
        <h1 className="page-header-title">Characters</h1>
        <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
          Headless Lich sessions · status polled every {POLL_MS / 1000}s (WS pending).
        </p>
      </header>
      
      {error && (
        <div style={{ marginBottom: "var(--space-4)", padding: "var(--space-3)", background: "var(--tint-bad)", border: "1px solid var(--bad)", borderRadius: "var(--radius-sm)", color: "var(--text-strong)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.char_name}
        ariaLabel="Lich character sessions"
        emptyState="No characters configured in entry.yaml."
        loading={loading}
      />
    </div>
  );
}
