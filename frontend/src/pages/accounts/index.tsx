import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../core/api";
import { can, type AuthState } from "../../core/auth";

interface AccountRow {
  account_name: string;
  auth_status: string;
  auth_error: string | null;
  last_scan: number;
}

export default function Accounts({ auth }: { auth: AuthState }) {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [totpSetup, setTotpSetup] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [entryName, setEntryName] = useState("");
  const [entryPass, setEntryPass] = useState("");
  const write = can(auth, ["accounts.write"]);

  async function refresh() {
    try {
      const [list, totp] = await Promise.all([
        api<{ accounts: AccountRow[] }>("/modules/accounts/accounts", auth),
        api<{ setup: boolean }>("/modules/accounts/totp/status", auth),
      ]);
      setAccounts(list.accounts);
      setTotpSetup(totp.setup);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  async function scan() {
    try {
      await api("/modules/accounts/accounts/scan", auth, { method: "POST", body: "{}" });
      setTimeout(() => void refresh(), 3_000);
    } catch (err) {
      setError((err as Error).message);
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
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addEntry(e: FormEvent) {
    e.preventDefault();
    if (!entryName || !entryPass) return;
    try {
      await api("/modules/accounts/entry/account", auth, {
        method: "POST",
        body: JSON.stringify({ account_name: entryName, password: entryPass, totp_code: totpCode }),
      });
      setEntryName("");
      setEntryPass("");
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed");
    }
  }

  return (
    <div>
      <h1>Accounts</h1>
      <p className="muted">Scanned accounts · entry.yaml management is TOTP-gated.</p>
      {error && <p className="error">{error}</p>}

      {write && (
        <div className="toolbar">
          <button className="btn" onClick={() => void scan()}>Scan all</button>
          {!totpSetup && !secret && (
            <button className="btn" onClick={() => void setupTotp()}>Set up TOTP</button>
          )}
        </div>
      )}
      {secret && qr && (
        <div className="panel totp-panel">
          <p className="muted">Scan this QR in your authenticator, then use its codes for entry changes.</p>
          <img src={qr} alt="TOTP QR" width="140" />
          <code>{secret}</code>
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr><th>Account</th><th>Auth</th><th>Last scan</th></tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.account_name}>
              <td>{a.account_name}</td>
              <td>
                <span className={`status-dot ${a.auth_status === "ok" ? "good" : a.auth_status === "bad_password" ? "muted" : "muted"}`} />
                {a.auth_status}
                {a.auth_error && <span className="muted"> — {a.auth_error.slice(0, 60)}</span>}
              </td>
              <td>{a.last_scan ? new Date(a.last_scan).toLocaleString() : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!accounts.length && !error && <p className="muted">No scans yet — run a scan.</p>}

      {write && totpSetup && (
        <form className="panel entry-form" onSubmit={addEntry}>
          <h2 className="section-title">Add account (entry.yaml)</h2>
          <input placeholder="account name" value={entryName} onChange={(e) => setEntryName(e.target.value)} />
          <input type="password" placeholder="password" value={entryPass} onChange={(e) => setEntryPass(e.target.value)} />
          <input placeholder="TOTP code" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} />
          <button className="btn" type="submit" disabled={!entryName || !entryPass || !totpCode}>
            Add
          </button>
        </form>
      )}
    </div>
  );
}
