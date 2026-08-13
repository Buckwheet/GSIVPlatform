import { useEffect } from "react";
import { useToast } from "../components";
import { can, type AuthState } from "../core/auth";
import { onWs } from "../core/ws";

/** Global (any-page) toast when a scan finishes with failures. */
export function ScanAlerts({ auth }: { auth: AuthState }) {
  const { addToast } = useToast();
  useEffect(() => {
    if (!can(auth, ["scans.read"])) return;
    return onWs((e) => {
      if (e.type !== "scan_alert") return;
      const p = e.payload as { failedAccounts?: string[]; message?: string };
      addToast({ tone: "bad", title: "⚠ Scan problem", message: p.message ?? "a scan failed" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);
  return null;
}
