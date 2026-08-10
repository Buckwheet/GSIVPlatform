import { NavLink, Outlet, useLocation } from "react-router-dom";
import { can, type AuthState } from "../core/auth";
import { NAV_GROUPS, NAV_ITEMS } from "../core/manifest";

interface Props {
  auth: AuthState;
  onSignOut: () => void;
}

/** Sidebar + topbar shell; nav is data-driven and scope-gated (nav-ia.md). */
export function AppShell({ auth, onSignOut }: Props) {
  const location = useLocation();
  const visible = NAV_ITEMS.filter((item) => can(auth, item.requiresScopes));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">◎ GSIV</div>
        <nav aria-label="Primary">
          {NAV_GROUPS.map((group) => {
            const items = visible.filter((i) => i.group === group.id).sort((a, b) => a.order - b.order);
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group.id}>
                <div className="nav-group-title">{group.title}</div>
                {items.map((item) => (
                  <NavLink
                    key={item.id}
                    to={item.path}
                    className={({ isActive }) => `nav-item${isActive || (item.path !== "/" && location.pathname.startsWith(item.path)) ? " active" : ""}`}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    <span>{item.title}</span>
                    {item.external && <span className="external-mark">↗</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <span className="topbar-title muted">GSIV Platform</span>
          <span className="topbar-right">
            <span className="muted">{auth.name}</span>
            <span className="scope-chip" title={auth.scopes.join(", ")}>
              {auth.scopes.includes("*") ? "admin" : `${auth.scopes.length} scope${auth.scopes.length === 1 ? "" : "s"}`}
            </span>
            <button className="link-btn" onClick={onSignOut}>
              Sign out
            </button>
          </span>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
