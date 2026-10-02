import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest, getToken, setToken, setUnauthorizedHandler } from './lib/api';
import type { User } from './lib/types';

type AuthContextValue = {
  user: User | null;
  /** True while a stored token is being checked on page load. */
  loading: boolean;
  startSession: (token: string, user: User) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => getToken() !== null);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const startSession = useCallback((token: string, nextUser: User) => {
    setToken(token);
    setUser(nextUser);
  }, []);

  useEffect(() => setUnauthorizedHandler(logout), [logout]);

  useEffect(() => {
    if (!getToken()) return;
    const controller = new AbortController();
    apiRequest<{ user: User }>('/api/auth/me', { signal: controller.signal })
      .then(({ user: me }) => setUser(me))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) logout();
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [logout]);

  const value = useMemo(() => ({ user, loading, startSession, logout }), [user, loading, startSession, logout]);
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
