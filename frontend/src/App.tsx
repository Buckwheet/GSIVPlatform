import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { can, clearAuth, loadAuth, type AuthState } from "./core/auth";
import { startWs, stopWs } from "./core/ws";
import { AppShell } from "./shell/AppShell";
import { TokenGate } from "./shell/TokenGate";
import Dashboard from "./pages/dashboard";
import Characters from "./pages/characters";
import Jars from "./pages/jars";
import Healer from "./pages/healer";
import Accounts from "./pages/accounts";
import Config from "./pages/config";
import Analysis from "./pages/analysis";
import Inventory from "./pages/inventory";
import Pricing from "./pages/pricing";

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(() => loadAuth());

  useEffect(() => {
    if (auth) startWs(auth);
    else stopWs();
    return () => stopWs();
  }, [auth]);

  if (!auth) return <TokenGate auth={null} onAuth={setAuth} />;

  const signOut = () => {
    clearAuth();
    setAuth(null);
  };

  return (
    <Routes>
      <Route element={<AppShell auth={auth} onSignOut={signOut} />}>
        <Route path="/" element={<Dashboard auth={auth} />} />
        {can(auth, ["characters.read"]) && <Route path="/characters" element={<Characters auth={auth} />} />}
        {can(auth, ["gems.read"]) && <Route path="/jars" element={<Jars auth={auth} />} />}
        {can(auth, ["healer.read"]) && <Route path="/healer" element={<Healer auth={auth} />} />}
        {can(auth, ["accounts.read"]) && <Route path="/accounts" element={<Accounts auth={auth} />} />}
        {can(auth, ["config.read"]) && <Route path="/config" element={<Config auth={auth} />} />}
        {can(auth, ["analysis.read"]) && <Route path="/analysis" element={<Analysis auth={auth} />} />}
        {can(auth, ["inventory.read"]) && <Route path="/inventory" element={<Inventory auth={auth} />} />}
        {can(auth, ["pricing.read"]) && <Route path="/pricing" element={<Pricing auth={auth} />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
