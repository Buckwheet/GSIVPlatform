import { useEffect } from "react";
import { useToast } from "../components";
import { can, type AuthState } from "../core/auth";
import { onWs } from "../core/ws";

/** Global (any-page) toast when an account is detected with no active characters. */
export function AccountAlerts({ auth }: { auth: AuthState }) {
  const { addToast } = useToast();
  useEffect(() => {
    if (!can(auth, ["accounts.read"])) return;
    return onWs((e) => {
      if (e.type !== "no_chars_alert") return;
      const p = e.payload as { account?: string; message?: string };
      addToast({
        tone: "warn",
        title: "⚠ No active characters",
        message: p.message ?? "an account has no active characters",
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);
  return null;
}
