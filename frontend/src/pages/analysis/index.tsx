import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../core/api";
import { can, type AuthState } from "../../core/auth";

export default function Analysis({ auth }: { auth: AuthState }) {
  const [analysis, setAnalysis] = useState<{ output: string; status: string; usage: unknown } | null>(null);
  const [history, setHistory] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [logFile, setLogFile] = useState<File | null>(null);
  const [uploadChar, setUploadChar] = useState("GSIV-Mejora");
  const write = can(auth, ["analysis.write"]);

  async function refresh() {
    try {
      const [a, h] = await Promise.all([
        api<{ output: string; status: string; usage: unknown }>("/modules/analysis/analysis", auth),
        api<unknown[]>("/modules/analysis/analysis/history", auth),
      ]);
      setAnalysis(a);
      setHistory(h);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  async function kick(path: string) {
    try {
      await api(path, auth, { method: "POST", body: "{}" });
      setTimeout(() => void refresh(), 2_000);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!logFile) return;
    const form = new FormData();
    form.append("file", logFile);
    form.append("character", uploadChar);
    try {
      const res = await api<{ ok: boolean; path: string; size: number }>("/modules/analysis/analysis/upload", auth, {
        method: "POST",
        body: form,
      });
      setError(res.ok ? `uploaded ${res.size} bytes → ${res.path}` : "upload failed");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "upload failed");
    }
  }

  return (
    <div>
      <h1>Analysis</h1>
      <p className="muted">Combat log analysis via the server-side scripts.</p>
      {error && <p className="error">{error}</p>}
      {write && (
        <div className="toolbar">
          <button className="btn" onClick={() => void kick("/modules/analysis/analysis/run")}>Run analysis</button>
          <button className="btn" onClick={() => void kick("/modules/analysis/analysis/loop")}>Shiva loop</button>
        </div>
      )}

      <div className="board-row">
        <section className="panel board-panel">
          <h2 className="section-title">Status</h2>
          <p className="muted">{analysis?.status || "—"}</p>
          {analysis?.usage ? <p className="muted">usage: {JSON.stringify(analysis.usage)}</p> : null}
        </section>
        <form className="panel board-panel" onSubmit={upload}>
          <h2 className="section-title">Upload combat log</h2>
          <input type="file" accept=".log" onChange={(e) => setLogFile(e.target.files?.[0] ?? null)} />
          <input placeholder="character (default GSIV-Mejora)" value={uploadChar} onChange={(e) => setUploadChar(e.target.value)} />
          <button className="btn" type="submit" disabled={!logFile || !write}>Upload</button>
          {!write && <p className="muted">read-only (no analysis.write)</p>}
        </form>
      </div>

      <section className="panel board-panel">
        <h2 className="section-title">Output</h2>
        <pre className="output">{analysis?.output || "(no output yet)"}</pre>
      </section>

      <section className="panel board-panel">
        <h2 className="section-title">History ({history.length})</h2>
        <pre className="output">{JSON.stringify(history, null, 2) || "[]"}</pre>
      </section>
    </div>
  );
}
