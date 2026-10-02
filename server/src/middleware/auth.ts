import { eq } from 'drizzle-orm';
import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { verifyToken } from '../lib/tokens.js';

export type AuthUser = { id: string; username: string; role: 'admin' | 'player' };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Checks the Bearer token and loads the user fresh from the database, so role changes and
 * deleted accounts take effect immediately instead of when the token expires.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  const userId = z.uuid().safeParse(token ? verifyToken(token) : null);
  if (!userId.success) throw new HttpError(401, 'Authentication required');

  const [user] = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(users)
    .where(eq(users.id, userId.data));
  if (!user) throw new HttpError(401, 'Authentication required');

  req.user = user;
  next();
};

export const requireRole =
  (...roles: AuthUser['role'][]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new HttpError(403, 'You do not have access to this resource');
    }
    next();
  };

/** The signed-in user. Only call this in handlers that run after `requireAuth`. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'Authentication required');
  return req.user;
}
