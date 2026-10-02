import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { api, closeConnections, createUser, resetState } from './helpers.js';

beforeEach(resetState);
afterAll(closeConnections);

const alice = { username: 'alice', email: 'Alice@Example.com', password: 'correct horse battery' };

describe('registration', () => {
  it('creates a player and returns a working token', async () => {
    const res = await api().post('/api/auth/register').send(alice).expect(201);
    expect(res.body.user).toEqual({ id: expect.any(String), username: 'alice', role: 'player' });

    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
    expect(me.body.user.username).toBe('alice');
  });

  it('cannot be used to self-assign the admin role', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ ...alice, role: 'admin' })
      .expect(201);
    expect(res.body.user.role).toBe('player');
  });

  it('stores argon2id hashes, not passwords', async () => {
    await api().post('/api/auth/register').send(alice).expect(201);
    const [row] = await db.select().from(users).where(eq(users.username, 'alice'));
    expect(row!.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row!.email).toBe('alice@example.com');
  });

  it('rejects duplicate usernames and emails, case-insensitively', async () => {
    await api().post('/api/auth/register').send(alice).expect(201);

    const dupName = await api()
      .post('/api/auth/register')
      .send({ ...alice, username: 'ALICE', email: 'other@example.com' })
      .expect(409);
    expect(dupName.body.error).toBe('Username is taken');

    const dupEmail = await api()
      .post('/api/auth/register')
      .send({ ...alice, username: 'alice2', email: 'ALICE@example.com' })
      .expect(409);
    expect(dupEmail.body.error).toBe('Email is already registered');
  });

  it('validates input', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ username: 'a b', email: 'nope', password: 'short' })
      .expect(400);
    expect(res.body.issues.map((issue: { path: string }) => issue.path).sort()).toEqual([
      'email',
      'password',
      'username',
    ]);
  });

  it('rejects malformed JSON', async () => {
    await api().post('/api/auth/register').set('Content-Type', 'application/json').send('{"oops"').expect(400);
  });
});

describe('login', () => {
  beforeEach(async () => {
    await api().post('/api/auth/register').send(alice).expect(201);
  });

  it('accepts the username or the email', async () => {
    await api().post('/api/auth/login').send({ username: 'Alice', password: alice.password }).expect(200);
    const res = await api()
      .post('/api/auth/login')
      .send({ username: 'alice@example.com', password: alice.password })
      .expect(200);
    expect(res.body.user).toEqual({ id: expect.any(String), username: 'alice', role: 'player' });
    expect(res.body.token).toEqual(expect.any(String));
  });

  it('gives the same answer for a wrong password and an unknown user', async () => {
    const wrongPassword = await api().post('/api/auth/login').send({ username: 'alice', password: 'nope' }).expect(401);
    const unknownUser = await api().post('/api/auth/login').send({ username: 'bob', password: 'nope' }).expect(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
  });
});

describe('tokens', () => {
  it('rejects missing, malformed, forged and unsigned tokens', async () => {
    const user = await createUser();
    const forged = jwt.sign({}, 'x'.repeat(40), { subject: user.id });
    const unsigned = jwt.sign({}, '', { subject: user.id, algorithm: 'none' });
    const expired = jwt.sign({}, process.env.JWT_SECRET!, { subject: user.id, expiresIn: -10 });

    await api().get('/api/auth/me').expect(401);
    for (const token of ['garbage', forged, unsigned, expired]) {
      await api().get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    }
    await api().get('/api/auth/me').set('Authorization', user.token).expect(200);
  });

  it('stops working once the user is deleted', async () => {
    const user = await createUser();
    await db.delete(users).where(eq(users.id, user.id));
    await api().get('/api/auth/me').set('Authorization', user.token).expect(401);
  });
});
