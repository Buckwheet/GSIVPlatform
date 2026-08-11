import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import type { CharacterRow } from "../../core/types";
import { Card, Button, Select, useToast } from "../../components";

export default function Config({ auth }: { auth: AuthState }) {
  const [chars, setChars] = useState<CharacterRow[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [go2, setGo2] = useState<Record<string, unknown>>({});
  const [eherbs, setEherbs] = useState<Record<string, unknown>>({});
  const [go2Text, setGo2Text] = useState("{}");
  const [eherbsText, setEherbsText] = useState("{}");
  const [files, setFiles] = useState<{ path: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingGo2, setSavingGo2] = useState(false);
  const [savingEherbs, setSavingEherbs] = useState(false);
  const { addToast } = useToast();
  const write = can(auth, ["config.write"]);

  useEffect(() => {
    void api<CharacterRow[]>("/modules/characters/characters", auth)
      .then((rows) => {
        setChars(rows);
        if (rows[0]) setSelected(rows[0].char_name);
      })
      .catch((err: Error) => setError(err.message));
  }, [auth]);

  useEffect(() => {
    if (!selected) return;
    setError(null);
    void api<Record<string, unknown>>(`/modules/config/go2/${encodeURIComponent(selected)}`, auth)
      .then((g) => {
        setGo2(g);
        setGo2Text(JSON.stringify(g, null, 2));
      })
      .catch((err: Error) => setError(err.message));
    void api<Record<string, unknown>>(`/modules/config/eherbs/${encodeURIComponent(selected)}`, auth)
      .then((e) => {
        setEherbs(e);
        setEherbsText(JSON.stringify(e, null, 2));
      })
      .catch((err: Error) => setError(err.message));
    void api<{ files: { path: string }[] }>(`/modules/config/config/${encodeURIComponent(selected)}`, auth)
      .then((f) => setFiles(f.files))
      .catch(() => setFiles([]));
  }, [selected, auth]);

  async function saveGo2(e: FormEvent) {
    e.preventDefault();
    setSavingGo2(true);
    try {
      await api(`/modules/config/go2/${encodeURIComponent(selected)}`, auth, {
        method: "PUT",
        body: go2Text,
      });
      setGo2(JSON.parse(go2Text) as Record<string, unknown>);
      setError(null);
      addToast({
        tone: "good",
        title: "go2 Config Saved",
        message: `Successfully updated go2 configurations for ${selected}.`,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "invalid JSON?";
      setError(msg);
      addToast({
        tone: "bad",
        title: "Save Failed",
        message: msg,
      });
    } finally {
      setSavingGo2(false);
    }
  }

  async function saveEherbs(e: FormEvent) {
    e.preventDefault();
    setSavingEherbs(true);
    try {
      await api(`/modules/config/eherbs/${encodeURIComponent(selected)}`, auth, {
        method: "PUT",
        body: eherbsText,
      });
      setEherbs(JSON.parse(eherbsText) as Record<string, unknown>);
      setError(null);
      addToast({
        tone: "good",
        title: "eherbs Config Saved",
        message: `Successfully updated eherbs configurations for ${selected}.`,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "invalid JSON?";
      setError(msg);
      addToast({
        tone: "bad",
        title: "Save Failed",
        message: msg,
      });
    } finally {
      setSavingEherbs(false);
    }
  }

  const charOptions = chars.map((c) => ({
    value: c.char_name,
    label: c.char_name,
  }));

  return (
    <div>
      <header className="page-header" style={{ flexDirection: "column" }}>
        <h1 className="page-header-title">Config</h1>
        <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
          Per-character go2 + eherbs settings and config files.
        </p>
      </header>

      {error && (
        <div style={{ marginBottom: "var(--space-4)", padding: "var(--space-3)", background: "var(--tint-bad)", border: "1px solid var(--bad)", borderRadius: "var(--radius-sm)", color: "var(--text-strong)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div style={{ maxWidth: "320px", marginBottom: "var(--space-4)" }}>
        <Select
          id="characterSelector"
          label="Active Character"
          value={selected}
          onChange={setSelected}
          options={charOptions}
          placeholder="Select character"
        />
      </div>

      <div className="board-row" style={{ marginBottom: "var(--space-4)" }}>
        <Card title="go2" ariaLabel="go2 configuration JSON editor">
          <form onSubmit={saveGo2} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <textarea
              rows={14}
              className="code-editor"
              value={go2Text}
              onChange={(e) => setGo2Text(e.target.value)}
              spellCheck={false}
            />
            {write ? (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button type="submit" variant="primary" loading={savingGo2} ariaLabel="Save go2 configurations">
                  Save go2
                </Button>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: "var(--font-size-xs)" }}>read-only (no config.write)</p>
            )}
          </form>
        </Card>

        <Card title="eherbs" ariaLabel="eherbs configuration JSON editor">
          <form onSubmit={saveEherbs} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <textarea
              rows={14}
              className="code-editor"
              value={eherbsText}
              onChange={(e) => setEherbsText(e.target.value)}
              spellCheck={false}
            />
            {write ? (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button type="submit" variant="primary" loading={savingEherbs} ariaLabel="Save eherbs configurations">
                  Save eherbs
                </Button>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: "var(--font-size-xs)" }}>read-only (no config.write)</p>
            )}
          </form>
        </Card>
      </div>

      <Card title={`Config files (${files.length})`} ariaLabel="List of character configuration files">
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.path}>
              <code>{f.path}</code>
            </li>
          ))}
          {!files.length && <li className="muted">no config dir yet</li>}
        </ul>
      </Card>
    </div>
  );
}
