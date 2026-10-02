import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { challenges } from '../src/db/schema.js';
import { hashFlag } from '../src/lib/flags.js';
import { api, closeConnections, createEvent, createUser, hoursFromNow, resetState } from './helpers.js';

beforeEach(resetState);
afterAll(closeConnections);

const FLAG = 'CTF{super_secret_admin_flag}';

describe('admin access control', () => {
  it('rejects anonymous users and players', async () => {
    const player = await createUser('player');
    await api().get('/api/admin/events').expect(401);
    await api().get('/api/admin/events').set('Authorization', player.token).expect(403);
    await api()
      .post('/api/admin/events')
      .set('Authorization', player.token)
      .send({ name: 'Nope', startsAt: hoursFromNow(1).toISOString(), endsAt: hoursFromNow(2).toISOString() })
      .expect(403);
  });

  it("hides other organizers' events and challenges", async () => {
    const owner = await createUser('admin');
    const other = await createUser('admin');
    const event = await createEvent(owner.id);
    const created = await api()
      .post(`/api/admin/events/${event.id}/challenges`)
      .set('Authorization', owner.token)
      .send({ title: 'Mine', category: 'web', flag: FLAG })
      .expect(201);

    await api().get(`/api/admin/events/${event.id}`).set('Authorization', other.token).expect(404);
    await api().get(`/api/admin/events/${event.id}/challenges`).set('Authorization', other.token).expect(404);
    await api()
      .patch(`/api/admin/events/${event.id}/challenges/${created.body.challenge.id}`)
      .set('Authorization', other.token)
      .send({ flag: 'CTF{hijacked}' })
      .expect(404);
    const list = await api().get('/api/admin/events').set('Authorization', other.token).expect(200);
    expect(list.body.events).toEqual([]);
  });

  it('returns 404 for malformed ids', async () => {
    const admin = await createUser('admin');
    await api().get('/api/admin/events/not-a-uuid').set('Authorization', admin.token).expect(404);
  });
});

describe('event CRUD', () => {
  it('creates, reads, updates and deletes an event', async () => {
    const admin = await createUser('admin');
    const startsAt = hoursFromNow(24).toISOString();
    const endsAt = hoursFromNow(48).toISOString();

    const created = await api()
      .post('/api/admin/events')
      .set('Authorization', admin.token)
      .send({ name: 'Spring CTF', startsAt, endsAt })
      .expect(201);
    const id = created.body.event.id;
    expect(created.body.event).toMatchObject({ name: 'Spring CTF', startsAt, endsAt });

    const updated = await api()
      .patch(`/api/admin/events/${id}`)
      .set('Authorization', admin.token)
      .send({ name: 'Summer CTF' })
      .expect(200);
    expect(updated.body.event).toMatchObject({ name: 'Summer CTF', startsAt, endsAt });

    await api().delete(`/api/admin/events/${id}`).set('Authorization', admin.token).expect(204);
    await api().get(`/api/admin/events/${id}`).set('Authorization', admin.token).expect(404);
  });

  it('rejects events that end before they start, on create and update', async () => {
    const admin = await createUser('admin');
    await api()
      .post('/api/admin/events')
      .set('Authorization', admin.token)
      .send({ name: 'Backwards', startsAt: hoursFromNow(2).toISOString(), endsAt: hoursFromNow(1).toISOString() })
      .expect(400);

    const event = await createEvent(admin.id, { startsAt: hoursFromNow(1), endsAt: hoursFromNow(5) });
    await api()
      .patch(`/api/admin/events/${event.id}`)
      .set('Authorization', admin.token)
      .send({ endsAt: hoursFromNow(0).toISOString() })
      .expect(400);
  });
});

describe('challenge CRUD', () => {
  it('manages challenges without ever exposing the flag', async () => {
    const admin = await createUser('admin');
    const event = await createEvent(admin.id);
    const base = `/api/admin/events/${event.id}/challenges`;

    const created = await api()
      .post(base)
      .set('Authorization', admin.token)
      .send({ title: 'SQLi 101', category: 'web', description: '# Find the flag', flag: FLAG })
      .expect(201);
    const challenge = created.body.challenge;
    expect(challenge).toMatchObject({ title: 'SQLi 101', category: 'web', isHidden: true, eventId: event.id });

    const [row] = await db.select().from(challenges).where(eq(challenges.id, challenge.id));
    expect(row!.flagHash).toBe(hashFlag(FLAG));

    const responses = [
      created,
      await api().get(base).set('Authorization', admin.token).expect(200),
      await api().get(`${base}/${challenge.id}`).set('Authorization', admin.token).expect(200),
    ];
    for (const res of responses) {
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(FLAG);
      expect(raw).not.toContain(row!.flagHash);
      expect(raw).not.toMatch(/"flag\w*":/i);
    }

    // Publishing only changes isHidden and leaves every other field alone.
    const published = await api()
      .patch(`${base}/${challenge.id}`)
      .set('Authorization', admin.token)
      .send({ isHidden: false })
      .expect(200);
    expect(published.body.challenge).toMatchObject({ isHidden: false, description: '# Find the flag' });
    const [unchanged] = await db.select().from(challenges).where(eq(challenges.id, challenge.id));
    expect(unchanged!.flagHash).toBe(hashFlag(FLAG));

    await api()
      .patch(`${base}/${challenge.id}`)
      .set('Authorization', admin.token)
      .send({ flag: 'CTF{rotated}' })
      .expect(200);
    const [rotated] = await db.select().from(challenges).where(eq(challenges.id, challenge.id));
    expect(rotated!.flagHash).toBe(hashFlag('CTF{rotated}'));

    await api().delete(`${base}/${challenge.id}`).set('Authorization', admin.token).expect(204);
    await api().get(`${base}/${challenge.id}`).set('Authorization', admin.token).expect(404);
  });

  it('validates category and required fields', async () => {
    const admin = await createUser('admin');
    const event = await createEvent(admin.id);
    const base = `/api/admin/events/${event.id}/challenges`;

    await api().post(base).set('Authorization', admin.token).send({ title: 'X', category: 'cooking', flag: FLAG }).expect(400);
    await api().post(base).set('Authorization', admin.token).send({ title: 'X', category: 'web' }).expect(400);
    await api().post(base).set('Authorization', admin.token).send({ title: 'X', category: 'web', flag: '   ' }).expect(400);
  });

  it('sets the scoring rules, and defaults them', async () => {
    const admin = await createUser('admin');
    const event = await createEvent(admin.id);
    const base = `/api/admin/events/${event.id}/challenges`;

    const defaults = await api()
      .post(base)
      .set('Authorization', admin.token)
      .send({ title: 'Default scoring', category: 'web', flag: FLAG })
      .expect(201);
    expect(defaults.body.challenge).toMatchObject({ initialPoints: 500, minPoints: 100, decay: 25 });

    const created = await api()
      .post(base)
      .set('Authorization', admin.token)
      .send({ title: 'Fixed value', category: 'web', flag: FLAG, initialPoints: 250, minPoints: 250, decay: 1 })
      .expect(201);
    expect(created.body.challenge).toMatchObject({ initialPoints: 250, minPoints: 250, decay: 1 });

    // A partial update is checked against the values it leaves alone.
    const id = created.body.challenge.id;
    await api().patch(`${base}/${id}`).set('Authorization', admin.token).send({ minPoints: 400 }).expect(400);
    const raised = await api()
      .patch(`${base}/${id}`)
      .set('Authorization', admin.token)
      .send({ initialPoints: 900 })
      .expect(200);
    expect(raised.body.challenge).toMatchObject({ initialPoints: 900, minPoints: 250 });

    await api()
      .post(base)
      .set('Authorization', admin.token)
      .send({ title: 'Upside down', category: 'web', flag: FLAG, initialPoints: 100, minPoints: 300 })
      .expect(400);
    await api()
      .post(base)
      .set('Authorization', admin.token)
      .send({ title: 'Too rich', category: 'web', flag: FLAG, initialPoints: 50_000 })
      .expect(400);
  });

  it('rejects duplicate titles within an event', async () => {
    const admin = await createUser('admin');
    const event = await createEvent(admin.id);
    const base = `/api/admin/events/${event.id}/challenges`;

    await api().post(base).set('Authorization', admin.token).send({ title: 'Twin', category: 'web', flag: FLAG }).expect(201);
    const dup = await api()
      .post(base)
      .set('Authorization', admin.token)
      .send({ title: 'TWIN', category: 'crypto', flag: FLAG })
      .expect(409);
    expect(dup.body.error).toMatch(/already exists/);
  });
});
