import { Link, Outlet } from 'react-router';
import { useAuth } from '../auth';

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <img className="brand-mark" src="/logo-mark.png" alt="" width={28} height={28} />
            FlagForge
          </Link>
          <nav className="topbar-nav">
            {user ? (
              <>
                <span className="whoami">
                  {user.username}
                  {user.role === 'admin' && <span className="role-tag">organizer</span>}
                </span>
                <button type="button" className="button ghost small" onClick={logout}>
                  Sign out
                </button>
              </>
            ) : (
              <Link to="/login" className="button small">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}
