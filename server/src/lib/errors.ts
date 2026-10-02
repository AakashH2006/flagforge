import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);

/** Parses a route id. Malformed ids get a 404 like missing ones, instead of a Postgres cast error. */
export function parseId(value: unknown, what: string): string {
  const result = z.uuid().safeParse(value);
  if (!result.success) throw notFound(what);
  return result.data;
}

type PgError = { code: string; constraint?: string };

/** Finds the Postgres error behind a failed query. Drizzle wraps driver errors in `cause`. */
export function pgError(err: unknown): PgError | undefined {
  let current = err;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return current as PgError;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export const isUniqueViolation = (err: unknown, constraint?: string) => {
  const pg = pgError(err);
  return pg?.code === '23505' && (constraint === undefined || pg.constraint === constraint);
};
