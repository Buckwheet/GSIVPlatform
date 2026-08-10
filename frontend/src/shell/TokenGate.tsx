import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../core/api";
import { can, loadAuth, saveAuth, type AuthState } from "../core/auth";

interface Props {
  auth: AuthState | null;
  onAuth: (a: AuthState) => void;
}

/** Token entry screen: validates against /api/me and stores name+scopes locally. */
export function TokenGate({ auth, onAuth }: Props) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (auth) return;
    // Try to re-validate a stored token automatically.
    const stored = loadAuth();
    if (!stored) return;
    void api<{ name: string; scopes: string[] }>("/me", stored)
      .then((me) => onAuth({ token: stored.token, name: me.name, scopes: me.scopes }))
      .catch(() => localStorage.removeItem("gsiv.token"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const me = await api<{ name: string; scopes: string[] }>("/me", { token: token.trim(), name: "", scopes: [] });
      const state: AuthState = { token: token.trim(), name: me.name, scopes: me.scopes };
      saveAuth(state);
      onAuth(state);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not reach the backend");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="token-gate">
      <div className="token-card panel">
        <h1>GSIV Platform</h1>
        <p className="muted">Enter an API token (from the server&apos;s AUTH_TOKENS) to connect.</p>
        <form onSubmit={submit}>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="token"
            autoFocus
            autoComplete="off"
          />
          <button type="submit" disabled={busy || !token.trim()}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        <p className="hint muted">
          Scopes are read from <code>/api/me</code>; nav items appear for scopes your token holds.
        </p>
      </div>
    </div>
  );
}
