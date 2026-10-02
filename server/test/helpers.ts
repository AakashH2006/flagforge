import { sql } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { challenges, events, users } from '../src/db/schema.js';
import { hashFlag } from '../src/lib/flags.js';
import { hashPassword } from '../src/lib/passwords.js';
import { signToken } from '../src/lib/tokens.js';
import { redis } from '../src/redis.js';

const app = createApp();
export const api = () => request(app);

export async function resetState() {
  await db.execute(sql`truncate table submissions, attachments, team_members, teams, challenges, events, users cascade`);
  await redis.flushdb();
}

export async function closeConnections() {
  await Promise.all([pool.end(), redis.quit()]);
}

export const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000);

let userCounter = 0;
const PASSWORD_HASH = hashPassword('password123');

export async function createUser(role: 'admin' | 'player' = 'player') {
  const username = `${role}${++userCounter}`;
  const [user] = await db
    .insert(users)
    .values({ username, email: `${username}@example.com`, passwordHash: await PASSWORD_HASH, role })
    .returning({ id: users.id, username: users.username });
  return { ...user!, token: `Bearer ${signToken(user!.id)}` };
}

export async function createEvent(
  createdBy: string,
  window: { startsAt: Date; endsAt: Date } = { startsAt: hoursFromNow(-1), endsAt: hoursFromNow(1) },
) {
  const [event] = await db
    .insert(events)
    .values({ name: 'Test Event', ...window, createdBy })
    .returning({ id: events.id });
  return event!;
}

export async function createChallenge(
  eventId: string,
  options: {
    title?: string;
    flag?: string;
    isHidden?: boolean;
    initialPoints?: number;
    minPoints?: number;
    decay?: number;
  } = {},
) {
  const { title, flag, isHidden, ...scoring } = options;
  const [challenge] = await db
    .insert(challenges)
    .values({
      eventId,
      title: title ?? 'Test Challenge',
      category: 'web',
      flagHash: hashFlag(flag ?? 'CTF{s3cr3t_fl4g}'),
      isHidden: isHidden ?? false,
      ...scoring,
    })
    .returning({ id: challenges.id });
  return challenge!;
}
