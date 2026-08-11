import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../core/api";
import { can, type AuthState } from "../../core/auth";
import { Card, Button, Input, useToast } from "../../components";

export default function Analysis({ auth }: { auth: AuthState }) {
  const [analysis, setAnalysis] = useState<{ output: string; status: string; usage: unknown } | null>(null);
  const [history, setHistory] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [logFile, setLogFile] = useState<File | null>(null);
  const [uploadChar, setUploadChar] = useState("GSIV-Mejora");
  const [running, setRunning] = useState(false);
  const [looping, setLooping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { addToast } = useToast();
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

  async function kick(path: string, type: "run" | "loop") {
    if (type === "run") setRunning(true);
    else setLooping(true);

    try {
      await api(path, auth, { method: "POST", body: "{}" });
      addToast({
        tone: "good",
        title: type === "run" ? "Analysis Started" : "Shiva Loop Started",
        message: "Successfully triggered combat log analysis script.",
      });
      setTimeout(() => void refresh().then(() => {
        setRunning(false);
        setLooping(false);
      }), 2_000);
    } catch (err) {
      setError((err as Error).message);
      setRunning(false);
      setLooping(false);
    }
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!logFile) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", logFile);
    form.append("character", uploadChar);
    try {
      const res = await api<{ ok: boolean; path: string; size: number }>("/modules/analysis/analysis/upload", auth, {
        method: "POST",
        body: form,
      });
      if (res.ok) {
        addToast({
          tone: "good",
          title: "Log Uploaded",
          message: `Uploaded ${res.size} bytes → ${res.path}`,
        });
        setError(null);
      } else {
        setError("upload failed");
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "upload failed";
      setError(msg);
      addToast({
        tone: "bad",
        title: "Upload Failed",
        message: msg,
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-header-title">Analysis</h1>
          <p className="muted" style={{ margin: "var(--space-1) 0 0 0" }}>
            Combat log analysis via the server-side scripts.
          </p>
        </div>
        {write && (
          <div className="page-header-actions">
            <Button disabled={running} onClick={() => kick("/modules/analysis/analysis/run", "run")} ariaLabel="Run analysis script">
              {running ? "Starting..." : "Run analysis"}
            </Button>
            <Button disabled={looping} onClick={() => kick("/modules/analysis/analysis/loop", "loop")} ariaLabel="Run Shiva loop script">
              {looping ? "Looping..." : "Shiva loop"}
            </Button>
          </div>
        )}
      </header>

      {error && (
        <div style={{ marginBottom: "var(--space-4)", padding: "var(--space-3)", background: "var(--tint-bad)", border: "1px solid var(--bad)", borderRadius: "var(--radius-sm)", color: "var(--text-strong)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="board-row" style={{ marginBottom: "var(--space-4)" }}>
        <Card title="Status" ariaLabel="Analysis script run status">
          <p style={{ margin: 0, fontWeight: "bold" }}>{analysis?.status || "—"}</p>
          {analysis?.usage ? (
            <div style={{ marginTop: "var(--space-2)" }}>
              <span className="muted" style={{ fontSize: "var(--font-size-xs)" }}>Usage:</span>
              <pre style={{ margin: "var(--space-1) 0 0 0", fontSize: "var(--font-size-xs)" }}>
                {JSON.stringify(analysis.usage, null, 2)}
              </pre>
            </div>
          ) : null}
        </Card>

        <Card title="Upload combat log" ariaLabel="Upload combat log file form">
          <form onSubmit={upload} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <label className="gs-input__label" htmlFor="combatLogFile">Combat Log File (.log)</label>
              <input
                id="combatLogFile"
                type="file"
                accept=".log"
                onChange={(e) => setLogFile(e.target.files?.[0] ?? null)}
                style={{
                  background: "var(--input-bg)",
                  border: "1px solid var(--border-strong)",
                  color: "var(--text)",
                  borderRadius: "var(--radius-sm)",
                  padding: "var(--space-2)",
                  fontSize: "var(--font-size-sm)",
                }}
              />
            </div>
            <Input
              id="uploadChar"
              label="Character (default GSIV-Mejora)"
              value={uploadChar}
              onChange={setUploadChar}
            />
            {write ? (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!logFile || uploading}
                  loading={uploading}
                  ariaLabel="Upload selected combat log"
                >
                  Upload
                </Button>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: "var(--font-size-xs)" }}>read-only (no analysis.write)</p>
            )}
          </form>
        </Card>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <Card title="Output" ariaLabel="Analysis script execution console output">
          <pre className="output" style={{ margin: 0 }}>{analysis?.output || "(no output yet)"}</pre>
        </Card>

        <Card title={`History (${history.length})`} ariaLabel="Analysis script history log">
          <pre className="output" style={{ margin: 0 }}>{JSON.stringify(history, null, 2) || "[]"}</pre>
        </Card>
      </div>
    </div>
  );
}
