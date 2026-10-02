const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
const TOKEN_KEY = 'ctf-builder.token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Set on 429 responses, from the Retry-After header. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export const toApiError = (err: unknown) =>
  err instanceof ApiError ? err : new ApiError(0, 'Something went wrong. Please try again.');

function readStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let token = readStoredToken();
let onUnauthorized: (() => void) | undefined;

export const getToken = () => token;

export function setToken(value: string | null) {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be unavailable (private mode). The session then lasts until the tab closes.
  }
}

/** Called when a signed-in request comes back 401, e.g. an expired token or a deleted account. */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

type ErrorBody = { error?: unknown; issues?: { path?: string; message?: string }[] };

function errorMessage(body: ErrorBody | null, status: number) {
  // Validation errors carry a generic `error` plus per-field `issues`. The first issue says more.
  const issue = body?.issues?.[0];
  if (issue?.message) {
    return issue.path ? `${issue.path[0]!.toUpperCase()}${issue.path.slice(1)}: ${issue.message}` : issue.message;
  }
  if (typeof body?.error === 'string') return body.error;
  return `Request failed (${status})`;
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const sentToken = token;
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (err) {
    if (options.signal?.aborted) throw err;
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as (T & ErrorBody) | null;

  if (!res.ok) {
    // Only sign out if the token that failed is still the current one.
    if (res.status === 401 && sentToken && sentToken === token) onUnauthorized?.();
    const retryAfter = Number(res.headers.get('Retry-After'));
    throw new ApiError(res.status, errorMessage(body, res.status), retryAfter > 0 ? retryAfter : undefined);
  }
  return body as T;
}

/**
 * Saves a file the API only serves to signed-in users. A plain link can't carry the token, so
 * the bytes come back over fetch and are handed to the browser as a blob instead.
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const sentToken = token;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: sentToken ? { Authorization: `Bearer ${sentToken}` } : {},
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorBody | null;
    if (res.status === 401 && sentToken && sentToken === token) onUnauthorized?.();
    throw new ApiError(res.status, errorMessage(body, res.status));
  }

  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // The browser reads the blob after the click returns, so the URL has to outlive it.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
