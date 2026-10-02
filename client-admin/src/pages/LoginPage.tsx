import { useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth';
import { PageLoader } from '../components/ui';
import { apiRequest, toApiError } from '../lib/api';
import type { User } from '../lib/types';

/**
 * Sign-in only. Registration creates players, so organizer accounts are made by the seed script
 * or by an existing organizer — there is nothing to sign up for here.
 */
export function LoginPage() {
  const { user, loading, startSession } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <PageLoader />;
  if (user) return <Navigate to={from} replace />;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const session = await apiRequest<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      startSession(session.token, session.user);
    } catch (err) {
      setError(toApiError(err).message);
      setPending(false);
    }
  }

  return (
    <div className="auth-wrap">
      <img className="auth-logo" src="/logo.png" alt="FlagForge" width={280} height={226} />
      <section className="panel auth-card">
        <div className="stack">
          <div>
            <h1>Organizer sign in</h1>
            <p className="muted small-text">Run your events, write challenges and publish them.</p>
          </div>

          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="field">
              <span className="label">Username or email</span>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="off"
                spellCheck={false}
                required
                autoFocus
              />
            </label>

            <label className="field">
              <span className="label">Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="button" disabled={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {import.meta.env.DEV && (
            <p className="hint">
              Demo organizer: <code>admin</code> / <code>admin-demo-pass</code>{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setUsername('admin');
                  setPassword('admin-demo-pass');
                }}
              >
                Fill in
              </button>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
