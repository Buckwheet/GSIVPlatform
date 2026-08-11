import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../core/api";
import { loadAuth, saveAuth, type AuthState } from "../core/auth";
import { Card, Input, Button } from "../components";

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
      <Card
        title="◎ GSIV Platform"
        padding="default"
        ariaLabel="Token authentication entry"
        footer={
          <p className="hint muted">
            Scopes are read from <code>/api/me</code>; nav items appear for scopes your token holds.
          </p>
        }
      >
        <p className="muted" style={{ marginTop: 0, marginBottom: "var(--space-4)" }}>
          Enter an API token (from the server&apos;s AUTH_TOKENS) to connect and manage resources.
        </p>
        <form onSubmit={submit}>
          <Input
            id="token"
            type="password"
            value={token}
            onChange={setToken}
            placeholder="token"
            autoFocus
            autoComplete="off"
            invalid={!!error}
            errorText={error || undefined}
            label="API Auth Token"
          />
          <div style={{ marginTop: "var(--space-3)" }}>
            <Button
              type="submit"
              variant="primary"
              disabled={!token.trim()}
              loading={busy}
              ariaLabel="Connect to platform"
              style={{ width: "100%" }}
            >
              Connect
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
