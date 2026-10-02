import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { submissions } from '../src/db/schema.js';
import {
  api,
  closeConnections,
  createChallenge,
  createEvent,
  createUser,
  hoursFromNow,
  resetState,
} from './helpers.js';

beforeEach(resetState);
afterAll(closeConnections);

const FLAG = 'CTF{s3cr3t_fl4g}';

type Player = Awaited<ReturnType<typeof createUser>>;

async function createTeam(eventId: string, player: Player, name = 'Hackers') {
  const res = await api()
    .post(`/api/events/${eventId}/teams`)
    .set('Authorization', player.token)
    .send({ name })
    .expect(201);
  return res.body.team as { id: string; name: string; inviteCode: string };
}

async function joinTeam(eventId: string, player: Player, inviteCode: string) {
  await api()
    .post(`/api/events/${eventId}/teams/join`)
    .set('Authorization', player.token)
    .send({ inviteCode })
    .expect(200);
}

const submit = (eventId: string, challengeId: string, player: Player, flag: string) =>
  api()
    .post(`/api/events/${eventId}/challenges/${challengeId}/submissions`)
    .set('Authorization', player.token)
    .send({ flag });

async function liveEventWithChallenge() {
  const admin = await createUser('admin');
  const event = await createEvent(admin.id);
  const challenge = await createChallenge(event.id, { flag: FLAG });
  return { admin, event, challenge };
}

describe('teams', () => {
  it('creates a team, joins it by invite code, and lists the members', async () => {
    const { event } = await liveEventWithChallenge();
    const [p1, p2, p3] = [await createUser(), await createUser(), await createUser()];

    const team = await createTeam(event.id, p1);
    expect(team.inviteCode).toMatch(/^[A-Za-z0-9_-]{12}$/);
    await joinTeam(event.id, p2, team.inviteCode);

    const me = await api().get(`/api/events/${event.id}/teams/me`).set('Authorization', p2.token).expect(200);
    expect(me.body.team.members.map((m: { username: string }) => m.username)).toEqual([p1.username, p2.username]);

    // One team per player per event.
    await api().post(`/api/events/${event.id}/teams`).set('Authorization', p1.token).send({ name: 'Other' }).expect(409);
    await api()
      .post(`/api/events/${event.id}/teams/join`)
      .set('Authorization', p1.token)
      .send({ inviteCode: team.inviteCode })
      .expect(409);

    // Team names are unique per event, case-insensitively.
    await api().post(`/api/events/${event.id}/teams`).set('Authorization', p3.token).send({ name: 'HACKERS' }).expect(409);
    await api()
      .post(`/api/events/${event.id}/teams/join`)
      .set('Authorization', p3.token)
      .send({ inviteCode: 'wrong-code' })
      .expect(404);
    await api().get(`/api/events/${event.id}/teams/me`).set('Authorization', p3.token).expect(404);
  });

  it("doesn't accept an invite code from a different event", async () => {
    const { admin, event } = await liveEventWithChallenge();
    const otherEvent = await createEvent(admin.id);
    const [p1, p2] = [await createUser(), await createUser()];

    const team = await createTeam(event.id, p1);
    await api()
      .post(`/api/events/${otherEvent.id}/teams/join`)
      .set('Authorization', p2.token)
      .send({ inviteCode: team.inviteCode })
      .expect(404);
  });

  it('blocks team changes after the event ends, and for admins', async () => {
    const admin = await createUser('admin');
    const ended = await createEvent(admin.id, { startsAt: hoursFromNow(-3), endsAt: hoursFromNow(-1) });
    const player = await createUser();

    await api().post(`/api/events/${ended.id}/teams`).set('Authorization', player.token).send({ name: 'Late' }).expect(403);
    const live = await createEvent(admin.id);
    await api().post(`/api/events/${live.id}/teams`).set('Authorization', admin.token).send({ name: 'Org' }).expect(403);
  });
});

describe('challenge list', () => {
  it('stays closed until the event starts', async () => {
    const admin = await createUser('admin');
    const upcoming = await createEvent(admin.id, { startsAt: hoursFromNow(1), endsAt: hoursFromNow(2) });
    await createChallenge(upcoming.id);
    const player = await createUser();

    const res = await api().get(`/api/events/${upcoming.id}/challenges`).set('Authorization', player.token).expect(403);
    expect(res.body.error).toMatch(/not started/);
  });

  it('shows only published challenges, never flag data', async () => {
    const { event, challenge } = await liveEventWithChallenge();
    await createChallenge(event.id, { title: 'Draft', isHidden: true });
    const player = await createUser();

    const res = await api().get(`/api/events/${event.id}/challenges`).set('Authorization', player.token).expect(200);
    expect(res.body.challenges).toEqual([
      {
        id: challenge.id,
        title: 'Test Challenge',
        description: '',
        category: 'web',
        points: 500,
        solves: 0,
        attachments: [],
        solved: false,
        solvedAt: null,
      },
    ]);
  });
});

describe('flag submission', () => {
  it('requires a team', async () => {
    const { event, challenge } = await liveEventWithChallenge();
    const player = await createUser();
    const res = await submit(event.id, challenge.id, player, FLAG).expect(403);
    expect(res.body.error).toMatch(/team/);
  });

  it('checks flags, records attempts, and shares solves with teammates', async () => {
    const { event, challenge } = await liveEventWithChallenge();
    const [p1, p2] = [await createUser(), await createUser()];
    const team = await createTeam(event.id, p1);
    await joinTeam(event.id, p2, team.inviteCode);

    expect((await submit(event.id, challenge.id, p1, 'CTF{nope}').expect(200)).body).toEqual({ result: 'incorrect' });
    expect((await submit(event.id, challenge.id, p1, `  ${FLAG}\n`).expect(200)).body).toEqual({
      result: 'correct',
      points: 500,
    });

    // p2 sees the challenge as solved, and can't solve it again.
    const list = await api().get(`/api/events/${event.id}/challenges`).set('Authorization', p2.token).expect(200);
    expect(list.body.challenges[0]).toMatchObject({ solved: true, solvedAt: expect.any(String) });
    expect((await submit(event.id, challenge.id, p2, FLAG).expect(200)).body).toEqual({ result: 'already_solved' });

    const rows = await db.select().from(submissions).where(eq(submissions.challengeId, challenge.id));
    expect(rows.map((r) => ({ userId: r.userId, isCorrect: r.isCorrect }))).toEqual(
      expect.arrayContaining([
        { userId: p1.id, isCorrect: false },
        { userId: p1.id, isCorrect: true },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it('records exactly one solve when teammates submit at the same time', async () => {
    const { event, challenge } = await liveEventWithChallenge();
    const [p1, p2] = [await createUser(), await createUser()];
    const team = await createTeam(event.id, p1);
    await joinTeam(event.id, p2, team.inviteCode);

    const results = await Promise.all(
      [p1, p2, p1, p2].map((player) => submit(event.id, challenge.id, player, FLAG).expect(200)),
    );
    const outcomes = results.map((res) => res.body.result).sort();
    expect(outcomes).toEqual(['already_solved', 'already_solved', 'already_solved', 'correct']);

    const solves = await db
      .select()
      .from(submissions)
      .where(and(eq(submissions.challengeId, challenge.id), eq(submissions.isCorrect, true)));
    expect(solves).toHaveLength(1);
  });

  it('keeps solves separate per team', async () => {
    const { event, challenge } = await liveEventWithChallenge();
    const [p1, p2] = [await createUser(), await createUser()];
    await createTeam(event.id, p1, 'Red');
    await createTeam(event.id, p2, 'Blue');

    expect((await submit(event.id, challenge.id, p1, FLAG)).body.result).toBe('correct');
    expect((await submit(event.id, challenge.id, p2, FLAG)).body.result).toBe('correct');
  });

  it('rejects submissions outside the event window', async () => {
    const admin = await createUser('admin');
    const player = await createUser();

    const upcoming = await createEvent(admin.id, { startsAt: hoursFromNow(1), endsAt: hoursFromNow(2) });
    const upcomingChallenge = await createChallenge(upcoming.id, { flag: FLAG });
    await createTeam(upcoming.id, player);
    const early = await submit(upcoming.id, upcomingChallenge.id, player, FLAG).expect(403);
    expect(early.body.error).toMatch(/not started/);

    const ended = await createEvent(admin.id, { startsAt: hoursFromNow(-3), endsAt: hoursFromNow(-1) });
    const endedChallenge = await createChallenge(ended.id, { flag: FLAG });
    const late = await submit(ended.id, endedChallenge.id, player, FLAG).expect(403);
    expect(late.body.error).toMatch(/ended/);
  });

  it("treats hidden challenges and other events' challenges as not found", async () => {
    const { admin, event } = await liveEventWithChallenge();
    const hidden = await createChallenge(event.id, { title: 'Draft', isHidden: true, flag: FLAG });
    const otherEvent = await createEvent(admin.id);
    const foreign = await createChallenge(otherEvent.id, { flag: FLAG });
    const player = await createUser();
    await createTeam(event.id, player);

    await submit(event.id, hidden.id, player, FLAG).expect(404);
    await submit(event.id, foreign.id, player, FLAG).expect(404);
    await submit(event.id, 'not-a-uuid', player, FLAG).expect(404);
  });

  it('does not let admins submit flags', async () => {
    const { admin, event, challenge } = await liveEventWithChallenge();
    await submit(event.id, challenge.id, admin, FLAG).expect(403);
  });

  it('rate limits submissions per user', async () => {
    const { event, challenge } = await liveEventWithChallenge();
    const [attacker, bystander] = [await createUser(), await createUser()];
    await createTeam(event.id, attacker, 'Scripters');
    await createTeam(event.id, bystander, 'Honest');

    // The test config allows 5 attempts per window.
    for (let i = 0; i < 5; i++) {
      await submit(event.id, challenge.id, attacker, `CTF{guess_${i}}`).expect(200);
    }
    const blocked = await submit(event.id, challenge.id, attacker, FLAG).expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // The correct flag doesn't bypass the limit, and other players aren't affected.
    await submit(event.id, challenge.id, bystander, 'CTF{nope}').expect(200);
    const rows = await db.select().from(submissions).where(eq(submissions.userId, attacker.id));
    expect(rows).toHaveLength(5);
  });
});
