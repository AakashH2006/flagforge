import { useEffect, useReducer, useState } from 'react';
import { type ApiError, apiRequest, toApiError } from './api';

export type Query<T> = { data?: T; error?: ApiError; loading: boolean; reload: () => void };

/**
 * GETs `path` and refetches when it changes. A null path skips the request.
 * On reload the previous data stays visible until the new response arrives.
 */
export function useApi<T>(path: string | null): Query<T> {
  const [version, reload] = useReducer((n: number) => n + 1, 0);
  const [result, setResult] = useState<{ path: string; version: number; data?: T; error?: ApiError }>();

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    apiRequest<T>(path, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ path, version, data });
      },
      (err: unknown) => {
        if (!controller.signal.aborted) setResult({ path, version, error: toApiError(err) });
      },
    );
    return () => controller.abort();
  }, [path, version]);

  const current = result?.path === path ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: path !== null && current?.version !== version,
    reload,
  };
}

/** Re-renders every `intervalMs` while it is not null. Read the time with Date.now() during render. */
export function useTick(intervalMs: number | null) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (intervalMs === null) return;
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
