import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { HttpError } from '../lib/errors.js';
import { redis } from '../redis.js';

/**
 * Sliding-window limiter stored in a Redis sorted set (one member per allowed request, scored by
 * time). It runs as a Lua script, so concurrent requests can't both slip past the limit.
 * Returns {allowed, retryAfterMs}.
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
if redis.call('ZCARD', key) >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, tonumber(oldest[2]) + window - now}
end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, window)
return {1, 0}
`;

export async function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const [allowed, retryAfterMs] = (await redis.eval(
    SLIDING_WINDOW_SCRIPT,
    1,
    key,
    now,
    windowMs,
    limit,
    `${now}:${randomUUID()}`,
  )) as [number, number];
  return { allowed: allowed === 1, retryAfterMs };
}

export function rateLimit(options: {
  name: string;
  limit: number;
  windowSeconds: number;
  key: (req: Request) => string;
}): RequestHandler {
  return async (req, res, next) => {
    const { allowed, retryAfterMs } = await consumeRateLimit(
      `ratelimit:${options.name}:${options.key(req)}`,
      options.limit,
      options.windowSeconds * 1000,
    );
    if (!allowed) {
      res.set('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      throw new HttpError(429, 'Too many attempts, try again later');
    }
    next();
  };
}
