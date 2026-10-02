import { eq, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { HttpError, isUniqueViolation } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { signToken } from '../lib/tokens.js';
import { currentUser, requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

export const authRouter = Router();

const publicUserColumns = { id: users.id, username: users.username, role: users.role };

const authLimit = rateLimit({
  name: 'auth',
  limit: env.AUTH_RATE_LIMIT_MAX,
  windowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
  key: (req) => req.ip ?? 'unknown',
});

const registerBody = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use only letters, numbers, underscores and hyphens'),
  email: z.email().max(254),
  password: z.string().min(8).max(128),
});

const loginBody = z.object({
  username: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});

authRouter.post('/register', authLimit, async (req, res) => {
  const body = registerBody.parse(req.body);
  const passwordHash = await hashPassword(body.password);

  try {
    const [user] = await db
      .insert(users)
      .values({ username: body.username, email: body.email.toLowerCase(), passwordHash })
      .returning(publicUserColumns);
    res.status(201).json({ token: signToken(user!.id), user });
  } catch (err) {
    if (isUniqueViolation(err, 'users_email_lower_idx')) {
      throw new HttpError(409, 'Email is already registered');
    }
    if (isUniqueViolation(err, 'users_username_lower_idx')) throw new HttpError(409, 'Username is taken');
    throw err;
  }
});

/** Accepts either the username or the email in the `username` field. */
authRouter.post('/login', authLimit, async (req, res) => {
  const body = loginBody.parse(req.body);
  const identifier = body.username.toLowerCase();

  const [user] = await db
    .select({ ...publicUserColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(or(eq(sql`lower(${users.username})`, identifier), eq(sql`lower(${users.email})`, identifier)));

  if (!(await verifyPassword(user?.passwordHash, body.password)) || !user) {
    throw new HttpError(401, 'Invalid username or password');
  }

  const { passwordHash: _omit, ...publicUser } = user;
  res.json({ token: signToken(user.id), user: publicUser });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: currentUser(req) });
});
