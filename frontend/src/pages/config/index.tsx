import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import type { CharacterRow } from "../../core/types";

export default function Config({ auth }: { auth: AuthState }) {
  const [chars, setChars] = useState<CharacterRow[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [go2, setGo2] = useState<Record<string, unknown>>({});
  const [eherbs, setEherbs] = useState<Record<string, unknown>>({});
  const [go2Text, setGo2Text] = useState("{}");
  const [eherbsText, setEherbsText] = useState("{}");
  const [files, setFiles] = useState<{ path: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
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
    try {
      await api(`/modules/config/go2/${encodeURIComponent(selected)}`, auth, {
        method: "PUT",
        body: go2Text,
      });
      setGo2(JSON.parse(go2Text) as Record<string, unknown>);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "invalid JSON?");
    }
  }

  async function saveEherbs(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/modules/config/eherbs/${encodeURIComponent(selected)}`, auth, {
        method: "PUT",
        body: eherbsText,
      });
      setEherbs(JSON.parse(eherbsText) as Record<string, unknown>);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "invalid JSON?");
    }
  }

  return (
    <div>
      <h1>Config</h1>
      <p className="muted">Per-character go2 + eherbs settings and config files.</p>
      {error && <p className="error">{error}</p>}
      <label className="muted">Character</label>
      <select value={selected} onChange={(e) => setSelected(e.target.value)}>
        {chars.map((c) => (
          <option key={c.char_name} value={c.char_name}>{c.char_name}</option>
        ))}
      </select>

      <div className="board-row">
        <form className="panel board-panel" onSubmit={saveGo2}>
          <h2 className="section-title">go2</h2>
          <textarea
            rows={14}
            className="code-editor"
            value={go2Text}
            onChange={(e) => setGo2Text(e.target.value)}
            spellCheck={false}
          />
          {write && <button className="btn" type="submit">Save go2</button>}
          {!write && <p className="muted">read-only (no config.write)</p>}
        </form>
        <form className="panel board-panel" onSubmit={saveEherbs}>
          <h2 className="section-title">eherbs</h2>
          <textarea
            rows={14}
            className="code-editor"
            value={eherbsText}
            onChange={(e) => setEherbsText(e.target.value)}
            spellCheck={false}
          />
          {write && <button className="btn" type="submit">Save eherbs</button>}
        </form>
      </div>

      <section className="panel board-panel">
        <h2 className="section-title">Config files ({files.length})</h2>
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.path}><code>{f.path}</code></li>
          ))}
          {!files.length && <li className="muted">no config dir yet</li>}
        </ul>
      </section>
    </div>
  );
}
