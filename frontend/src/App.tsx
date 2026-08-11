import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { can, clearAuth, loadAuth, type AuthState } from "./core/auth";
import { startWs, stopWs } from "./core/ws";
import { NAV_ITEMS } from "./core/manifest";
import { AppShell } from "./shell/AppShell";
import { TokenGate } from "./shell/TokenGate";
import { Skeleton } from "./components";

function PageLoading() {
  return (
    <div className="page-loading" role="status" aria-label="Loading page">
      <Skeleton variant="text" lines={3} />
    </div>
  );
}

/** One nav item's page, lazily imported so Vite code-splits per module. */
function NavPage({ item, auth }: { item: (typeof NAV_ITEMS)[number]; auth: AuthState }) {
  const Page = lazy(item.load as () => Promise<{ default: ComponentType<{ auth: AuthState }> }>);
  return (
    <Suspense fallback={<PageLoading />}>
      <Page auth={auth} />
    </Suspense>
  );
}

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

  // Routes fall out of the registry manifest (routing.md): every nav item whose
  // scopes the token holds becomes a route; the dashboard item is the index.
  const visible = NAV_ITEMS.filter((item) => can(auth, item.requiresScopes));
  const dashboard = visible.find((item) => item.path === "/");
  const modules = visible.filter((item) => item.path !== "/");

  return (
    <Routes>
      <Route element={<AppShell auth={auth} onSignOut={signOut} />}>
        {dashboard && <Route index element={<NavPage item={dashboard} auth={auth} />} />}
        {modules.map((item) => (
          <Route key={item.id} path={item.path} element={<NavPage item={item} auth={auth} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
