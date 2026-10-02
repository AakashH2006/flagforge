import { useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth';
import { PageLoader } from '../components/ui';
import { apiRequest, toApiError } from '../lib/api';
import type { User } from '../lib/types';

type Mode = 'login' | 'register';

export function LoginPage() {
  const { user, loading, startSession } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <PageLoader />;
  if (user) return <Navigate to={from} replace />;

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const body = mode === 'login' ? { username, password } : { username, email, password };
      const session = await apiRequest<{ token: string; user: User }>(`/api/auth/${mode}`, {
        method: 'POST',
        body,
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
        <div className="tabs" role="tablist" aria-label="Account">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className="tab"
            onClick={() => switchMode('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className="tab"
            onClick={() => switchMode('register')}
          >
            Create account
          </button>
        </div>

        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="field">
            <span className="label">{mode === 'login' ? 'Username or email' : 'Username'}</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              required
              {...(mode === 'register' && { minLength: 3, maxLength: 32, pattern: '[A-Za-z0-9_\\-]+' })}
            />
            {mode === 'register' && <span className="hint">3–32 letters, numbers, underscores or hyphens.</span>}
          </label>

          {mode === 'register' && (
            <label className="field">
              <span className="label">Email</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
          )}

          <label className="field">
            <span className="label">Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              {...(mode === 'register' && { minLength: 8, maxLength: 128 })}
            />
            {mode === 'register' && <span className="hint">At least 8 characters.</span>}
          </label>

          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="button" disabled={pending}>
            {pending ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {import.meta.env.DEV && mode === 'login' && (
          <p className="hint demo-hint">
            Demo player: <code>player</code> / <code>player-demo-pass</code>{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setUsername('player');
                setPassword('player-demo-pass');
              }}
            >
              Fill in
            </button>
          </p>
        )}
      </section>
    </div>
  );
}
