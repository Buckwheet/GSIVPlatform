import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { can, clearAuth, loadAuth, type AuthState } from "./core/auth";
import { AppShell } from "./shell/AppShell";
import { TokenGate } from "./shell/TokenGate";
import Dashboard from "./pages/dashboard";
import Characters from "./pages/characters";

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(() => loadAuth());

  if (!auth) return <TokenGate auth={null} onAuth={setAuth} />;

  const signOut = () => {
    clearAuth();
    setAuth(null);
  };

  return (
    <Routes>
      <Route element={<AppShell auth={auth} onSignOut={signOut} />}>
        <Route path="/" element={<Dashboard auth={auth} />} />
        {can(auth, ["characters.read"]) && (
          <Route path="/characters" element={<Characters auth={auth} />} />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
