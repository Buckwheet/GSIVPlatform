import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import { Card, Button, Input, Table, StatusDot, useToast } from "../../components";

interface AccountRow {
  account_name: string;
  auth_status: string;
  auth_error: string | null;
  last_scan: number;
  no_active_chars: number;
}

interface StaleChar {
  account_name: string;
  char_name: string;
  status: string;
  last_seen: number | null;
  transferred_to?: string | null;
}

interface StaleAccount {
  account_name: string;
  auth_status: string;
  auth_error: string | null;
}

interface StaleReport {
  characters: StaleChar[];
  accounts: StaleAccount[];
}

export default function Accounts({ auth }: { auth: AuthState }) {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [totpSetup, setTotpSetup] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [entryName, setEntryName] = useState("");
  const [entryPass, setEntryPass] = useState("");
  const [scanning, setScanning] = useState(false);
  const [stale, setStale] = useState<StaleReport | null>(null);
  const [adding, setAdding] = useState(false);
  const [cleanupCode, setCleanupCode] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const { addToast } = useToast();
  const write = can(auth, ["accounts.write"]);

  async function refresh() {
    try {
      const [list, totp, staleRes] = await Promise.all([
        api<{ accounts: AccountRow[] }>("/modules/accounts/accounts", auth),
        api<{ setup: boolean }>("/modules/accounts/totp/status", auth),
        api<StaleReport>("/modules/accounts/accounts/stale", auth),
      ]);
      setAccounts(list.accounts);
      setTotpSetup(totp.setup);
      setStale(staleRes);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  async function scan() {
    setScanning(true);
    try {
      await api("/modules/accounts/accounts/scan", auth, { method: "POST", body: "{}" });
      addToast({
        tone: "info",
        title: "Scan Started",
        message: "Account scan has been queued. Refreshing in 3 seconds.",
      });
      setTimeout(() => {
        void refresh().then(() => setScanning(false));
      }, 3_000);
    } catch (err) {
      setError((err as Error).message);
      setScanning(false);
    }
  }

  async function setupTotp() {
    try {
      const res = await api<{ secret: string; uri: string; qrDataUrl: string }>("/modules/accounts/totp/setup", auth, {
        method: "POST",
        body: "{}",
      });
      setSecret(res.secret);
      setQr(res.qrDataUrl);
      addToast({
        tone: "good",
        title: "TOTP Secret Generated",
        message: "Scan the QR code to finish set up.",
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addEntry(e: FormEvent) {
    e.preventDefault();
    if (!entryName || !entryPass || !totpCode) return;
    setAdding(true);
    try {
      await api("/modules/accounts/entry/account", auth, {
        method: "POST",
        body: JSON.stringify({ account_name: entryName, password: entryPass, totp_code: totpCode }),
      });
      setEntryName("");
      setEntryPass("");
      setTotpCode("");
      setError(null);
      addToast({
        tone: "good",
        title: "Account Added",
        message: `Successfully added ${entryName} to entry.yaml.`,
      });
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "failed";
      setError(msg);
      addToast({
        tone: "bad",
        title: "Add Failed",
        message: msg,
      });
    } finally {
      setAdding(false);
    }
  }

  async function cleanupStale() {
    if (!cleanupCode) return;
    setCleaning(true);
    try {
      const res = await api<{
        ok: boolean;
        removedAccounts: number;
        removedCharacters: number;
        steps: { action: string; result: string }[];
      }>("/modules/accounts/accounts/stale/cleanup", auth, {
        method: "POST",
        body: JSON.stringify({ totp_code: cleanupCode }),
      });
      setCleanupCode("");
      addToast({
        tone: "good",
        title: "Cleanup Complete",
        message: `Removed ${res.removedAccounts} account(s) and ${res.removedCharacters} character(s) from entry.yaml, inv.db3 and the dashboard.`,
      });
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "failed";
      setError(msg);
      addToast({ tone: "bad", title: "Cleanup Failed", message: msg });
    } finally {
      setCleaning(false);
    }
  }

  const columns = [
    { key: "account_name", header: "Account", sortable: true },
    {
      key: "auth_status",
      header: "Auth Status",
      sortable: true,
      render: (a: AccountRow) => {
        const isOk = a.auth_status === "ok";
        const dotColor = isOk ? "good" : a.auth_status === "bad_password" ? "warn" : "bad";
        return (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--control-gap)" }}>
            <StatusDot color={dotColor} label={a.auth_status} />
            {a.auth_error && (
              <span className="muted" style={{ fontSize: "var(--font-size-xs)" }}>
                {" "}
                — {a.auth_error.slice(0, 60)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "last_scan",
      header: "Last Scan",
      sortable: true,
      render: (a: AccountRow) => (a.last_scan ? new Date(a.last_scan).toLocaleString() : "—"),
    },
  ];

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-header-title">Accounts</h1>
          <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
            Scanned accounts · entry.yaml management is TOTP-gated.
          </p>
        </div>
        {write && (
          <div className="page-header-actions">
            <Button disabled={scanning} onClick={scan} ariaLabel="Scan all accounts">
              {scanning ? "Scanning..." : "Scan all"}
            </Button>
            {!totpSetup && !secret && (
              <Button onClick={setupTotp} ariaLabel="Set up TOTP authentication">
                Set up TOTP
              </Button>
            )}
          </div>
        )}
      </header>

      {error && (
        <div style={{ marginBottom: "var(--space-4)", padding: "var(--space-3)", background: "var(--tint-bad)", border: "1px solid var(--bad)", borderRadius: "var(--radius-sm)", color: "var(--text-strong)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {secret && qr && (
        <Card
          title="TOTP Enrollment"
          padding="default"
          className="totp-panel"
          style={{ marginBottom: "var(--space-4)" }}
          ariaLabel="TOTP configuration credentials"
        >
          <p className="muted" style={{ margin: 0 }}>
            Scan this QR in your authenticator app, then use its generated codes to authorize entry mutations.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap", marginTop: "var(--space-2)" }}>
            <img src={qr} alt="TOTP QR Code" width="140" style={{ border: "4px solid white", borderRadius: "var(--radius-sm)" }} />
            <div>
              <p style={{ margin: "0 0 var(--space-2) 0", fontWeight: "bold" }}>Secret Key</p>
              <code>{secret}</code>
            </div>
          </div>
        </Card>
      )}

      {accounts.some((a) => a.no_active_chars === 1) && (
        <div
          style={{
            marginBottom: "var(--space-4)",
            padding: "var(--space-3)",
            background: "var(--tint-warn)",
            border: "1px solid var(--warn)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-strong)",
          }}
        >
          <strong>No active characters — cancel billing?</strong>{" "}
          {accounts
            .filter((a) => a.no_active_chars === 1)
            .map((a) => a.account_name)
            .join(", ")}
        </div>
      )}
            {stale && (stale.characters.length > 0 || stale.accounts.length > 0) && (
        <div
          style={{
            marginBottom: "var(--space-4)",
            padding: "var(--space-3)",
            background: "var(--tint-warn)",
            border: "1px solid var(--warn)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-strong)",
          }}
        >
          <strong>Roster issues:</strong> {stale.characters.length} stale{" "}
          {stale.characters.length === 1 ? "character" : "characters"} ·{" "}
          {stale.accounts.length} {stale.accounts.length === 1 ? "account" : "accounts"} with auth errors
          <details style={{ marginTop: "var(--space-2)" }}>
            <summary style={{ cursor: "pointer" }}>Show details</summary>
            <ul style={{ margin: "var(--space-2) 0 0 0", paddingLeft: "var(--space-4)" }}>
              {stale.characters.map((c) => (
                <li key={`c-${c.account_name}-${c.char_name}`}>
                  <code>{c.char_name}</code> · {c.account_name}
                  {c.last_seen ? ` · last seen ${new Date(c.last_seen).toLocaleString()}` : " · never seen active"}
                  {c.transferred_to ? ` · ⚠ possibly transferred to ${c.transferred_to}` : ""}
                </li>
              ))}
              {stale.accounts.map((a) => (
                <li key={`a-${a.account_name}`}>
                  <code>{a.account_name}</code> · {a.auth_status}
                  {a.auth_error ? ` (${a.auth_error.slice(0, 60)})` : ""}
                </li>
              ))}
            </ul>
          </details>
          {write && totpSetup && (
            <div style={{ marginTop: "var(--space-2)", display: "flex", gap: "var(--space-2)", alignItems: "flex-end" }}>
              <div style={{ flex: "0 0 150px" }}>
                <Input
                  id="cleanupTotp"
                  label="TOTP code"
                  value={cleanupCode}
                  onChange={setCleanupCode}
                  placeholder="000000"
                />
              </div>
              <Button
                variant="primary"
                onClick={cleanupStale}
                disabled={!cleanupCode || cleaning}
                loading={cleaning}
                ariaLabel="Clean up stale accounts and characters"
              >
                Clean up stale
              </Button>
            </div>
          )}
        </div>
      )}

      <Table
        columns={columns}
        rows={accounts}
        rowKey={(a) => a.account_name}
        ariaLabel="Platform user accounts list"
        emptyState="No accounts scanned yet — trigger a scan."
        loading={loading}
      />

      {write && totpSetup && (
        <div style={{ marginTop: "var(--section-gap)" }}>
          <Card title="Add account (entry.yaml)" ariaLabel="Add account form card">
            <form onSubmit={addEntry} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", maxWidth: "420px" }}>
              <Input
                id="accountName"
                label="Account name"
                value={entryName}
                onChange={setEntryName}
                required
              />
              <Input
                id="accountPass"
                type="password"
                label="Password"
                value={entryPass}
                onChange={setEntryPass}
                required
              />
              <Input
                id="totpCode"
                label="TOTP code"
                value={totpCode}
                onChange={setTotpCode}
                placeholder="000000"
                required
              />
              <div style={{ marginTop: "var(--space-1)" }}>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!entryName || !entryPass || !totpCode || adding}
                  loading={adding}
                  ariaLabel="Add account details"
                >
                  Add
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
