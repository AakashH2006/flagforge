const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
// Deliberately not the participant client's key: an organizer may have both open on one host.
const TOKEN_KEY = 'flagforge.admin.token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
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

const authHeader = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

/** Turns a failed response into an ApiError, signing out if the token itself was rejected. */
async function failure(res: Response, sentToken: string | null) {
  const body = (await res.json().catch(() => null)) as ErrorBody | null;
  // Only sign out if the token that failed is still the current one.
  if (res.status === 401 && sentToken && sentToken === token) onUnauthorized?.();
  return new ApiError(res.status, errorMessage(body, res.status));
}

const UNREACHABLE = "Can't reach the server. Check your connection and try again.";

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const sentToken = token;
  const headers: Record<string, string> = { ...authHeader() };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

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
    throw new ApiError(0, UNREACHABLE);
  }

  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await failure(res, sentToken);
  return (await res.json().catch(() => null)) as T;
}

/** POSTs one file as multipart/form-data. The browser sets the boundary, so no Content-Type here. */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const sentToken = token;
  const form = new FormData();
  form.append('file', file);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: authHeader(), body: form });
  } catch {
    throw new ApiError(0, UNREACHABLE);
  }
  if (!res.ok) throw await failure(res, sentToken);
  return (await res.json()) as T;
}

/**
 * Saves a file the API only serves to signed-in users. A plain link can't carry the token, so
 * the bytes come back over fetch and are handed to the browser as a blob instead.
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const sentToken = token;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: authHeader() });
  } catch {
    throw new ApiError(0, UNREACHABLE);
  }
  if (!res.ok) throw await failure(res, sentToken);

  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // The browser reads the blob after the click returns, so the URL has to outlive it.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
