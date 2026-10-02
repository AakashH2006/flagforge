import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { submissions, teamMembers, teams } from '../src/db/schema.js';
import { closeRealtime, createRealtime, SCOREBOARD_EVENT } from '../src/realtime.js';
import { redis } from '../src/redis.js';
import { scoreboardSnapshot } from '../src/services/scoreboard.js';
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
afterAll(async () => {
  await closeRealtime();
  await closeConnections();
});

const EVENT_START = hoursFromNow(-2);
const EVENT_WINDOW = { startsAt: EVENT_START, endsAt: hoursFromNow(2) };
const minutesIn = (minutes: number) => new Date(EVENT_START.getTime() + minutes * 60_000);

type ScoreboardBody = {
  totalTeams: number;
  updatedAt: string;
  teams: { rank: number; teamId: string; name: string; score: number; solves: number; firstBloods: number }[];
  challenges: { id: string; points: number; solves: number; firstBlood: { name: string } | null }[];
};

/** A team with its own member, so solves can be attributed without going through the API. */
async function seedTeam(eventId: string, name: string) {
  const user = await createUser();
  const [team] = await db
    .insert(teams)
    .values({ eventId, name, inviteCode: `code-${name.toLowerCase().replaceAll(' ', '-')}` })
    .returning({ id: teams.id });
  await db.insert(teamMembers).values({ eventId, teamId: team!.id, userId: user.id });
  return { id: team!.id, name, user };
}

function solve(eventId: string, team: { id: string; user: { id: string } }, challengeId: string, minute: number) {
  return db.insert(submissions).values({
    eventId,
    challengeId,
    teamId: team.id,
    userId: team.user.id,
    isCorrect: true,
    submittedAt: minutesIn(minute),
  });
}

const getScoreboard = (eventId: string, query = '') =>
  api()
    .get(`/api/events/${eventId}/scoreboard${query}`)
    .expect(200)
    .then((res) => res.body as ScoreboardBody);

describe('scoreboard', () => {
  it('ranks teams on points, then on who got there first', async () => {
    const admin = await createUser('admin');
    const event = await createEvent(admin.id, EVENT_WINDOW);
    const web = await createChallenge(event.id, { title: 'Web', initialPoints: 300, minPoints: 100, decay: 10 });
    const crypto = await createChallenge(event.id, { title: 'Crypto', initialPoints: 200, minPoints: 200, decay: 10 });

    const fast = await seedTeam(event.id, 'Fast');
    const slow = await seedTeam(event.id, 'Slow');
    const idle = await seedTeam(event.id, 'Idle');
    await solve(event.id, fast, web.id, 5);
    await solve(event.id, fast, crypto.id, 20);
    await solve(event.id, slow, crypto.id, 30);
    await solve(event.id, slow, web.id, 40);

    const board = await getScoreboard(event.id);
    expect(board.totalTeams).toBe(3);
    expect(board.teams.map((team) => [team.rank, team.name, team.score, team.solves])).toEqual([
      // Web is worth 298 to both of them now that two teams have it, plus 200 for Crypto.
      // Their totals are level, so the tie goes to the team that finished first.
      [1, 'Fast', 498, 2],
      [2, 'Slow', 498, 2],
      [3, 'Idle', 0, 0],
    ]);
    // Fast was first to both challenges.
    expect(board.teams[0]!.firstBloods).toBe(2);
    expect(board.challenges.find((entry) => entry.id === web.id)?.firstBlood?.name).toBe('Fast');
  });

  it('devalues a challenge as more teams solve it, for everyone holding the solve', async () => {
    const admin = await createUser('admin');
    const event = await createEvent(admin.id, EVENT_WINDOW);
    const challenge = await createChallenge(event.id, { initialPoints: 500, minPoints: 100, decay: 4 });

    const first = await seedTeam(event.id, 'First');
    await solve(event.id, first, challenge.id, 1);
    const afterOne = await getScoreboard(event.id);
    expect(afterOne.teams[0]!.score).toBe(500);
    expect(afterOne.challenges[0]!.points).toBe(500);

    const second = await seedTeam(event.id, 'Second');
    await solve(event.id, second, challenge.id, 2);
    await redis.flushdb(); // the snapshot is rebuilt from Postgres on the next read

    const afterTwo = await getScoreboard(event.id);
    expect(afterTwo.challenges[0]!.solves).toBe(2);
    expect(afterTwo.challenges[0]!.points).toBe(475);
    // The first solver's total drops too: a challenge is worth the same to every team holding it.
    expect(afterTwo.teams.map((team) => team.score)).toEqual([475, 475]);
  });

  it('serves repeat reads from the Redis snapshot', async () => {
    const admin = await createUser('admin');
    const event = await createEvent(admin.id, EVENT_WINDOW);
    const challenge = await createChallenge(event.id, { initialPoints: 300, minPoints: 300, decay: 10 });
    const team = await seedTeam(event.id, 'Cached');
    await solve(event.id, team, challenge.id, 3);

    const first = await getScoreboard(event.id);
    expect(await redis.zscore(`scoreboard:${event.id}:rank`, team.id)).not.toBeNull();

    // A solve written straight to Postgres doesn't invalidate anything, so the cached snapshot
    // is what comes back until something republishes it.
    const other = await seedTeam(event.id, 'Unseen');
    await solve(event.id, other, challenge.id, 4);
    const second = await getScoreboard(event.id);
    expect(second.updatedAt).toBe(first.updatedAt);
    expect(second.teams).toHaveLength(1);
  });

  it('updates the standings when a flag is submitted, and tells the solver what it was worth', async () => {
    const admin = await createUser('admin');
    const event = await createEvent(admin.id, EVENT_WINDOW);
    const challenge = await createChallenge(event.id, { flag: 'CTF{go}', initialPoints: 400, minPoints: 100 });
    const player = await createUser();
    await api()
      .post(`/api/events/${event.id}/teams`)
      .set('Authorization', player.token)
      .send({ name: 'Newcomers' })
      .expect(201);

    const submission = await api()
      .post(`/api/events/${event.id}/challenges/${challenge.id}/submissions`)
      .set('Authorization', player.token)
      .send({ flag: 'CTF{go}' })
      .expect(200);
    expect(submission.body).toEqual({ result: 'correct', points: 400 });

    const board = await getScoreboard(event.id);
    expect(board.teams[0]).toMatchObject({ rank: 1, name: 'Newcomers', score: 400, solves: 1 });

    // And the challenge list carries the same value.
    const list = await api()
      .get(`/api/events/${event.id}/challenges`)
      .set('Authorization', player.token)
      .expect(200);
    expect(list.body.challenges[0]).toMatchObject({ points: 400, solves: 1, solved: true });
  });

  it('leaves hidden challenges out of the scoring', async () => {
    const admin = await createUser('admin');
    const event = await createEvent(admin.id, EVENT_WINDOW);
    const open = await createChallenge(event.id, { title: 'Open', initialPoints: 100, minPoints: 100 });
    const secret = await createChallenge(event.id, {
      title: 'Secret',
      isHidden: true,
      initialPoints: 900,
      minPoints: 900,
    });
    const team = await seedTeam(event.id, 'Insiders');
    await solve(event.id, team, open.id, 1);
    await solve(event.id, team, secret.id, 2);

    const board = await getScoreboard(event.id);
    expect(board.challenges.map((entry) => entry.id)).toEqual([open.id]);
    expect(board.teams[0]).toMatchObject({ score: 100, solves: 1 });
  });

  it('is public, but not before the event starts', async () => {
    const admin = await createUser('admin');
    const upcoming = await createEvent(admin.id, { startsAt: hoursFromNow(1), endsAt: hoursFromNow(2) });
    await api().get(`/api/events/${upcoming.id}/scoreboard`).expect(403);
    await api().get(`/api/events/${upcoming.id}/scoreboard/history`).expect(403);
    await api().get(`/api/events/${crypto.randomUUID()}/scoreboard`).expect(404);

    // No token needed once it is live.
    const live = await createEvent(admin.id, EVENT_WINDOW);
    await api().get(`/api/events/${live.id}/scoreboard`).expect(200);
  });

  it('returns a running total per team for the graph', async () => {
    const admin = await createUser('admin');
    const event = await createEvent(admin.id, EVENT_WINDOW);
    const one = await createChallenge(event.id, { title: 'One', initialPoints: 100, minPoints: 100 });
    const two = await createChallenge(event.id, { title: 'Two', initialPoints: 250, minPoints: 250 });
    const climbers = await seedTeam(event.id, 'Climbers');
    await solve(event.id, climbers, one.id, 10);
    await solve(event.id, climbers, two.id, 25);

    const res = await api().get(`/api/events/${event.id}/scoreboard/history`).expect(200);
    expect(res.body.teams).toEqual([
      {
        teamId: climbers.id,
        name: 'Climbers',
        points: [
          { at: minutesIn(10).toISOString(), score: 100 },
          { at: minutesIn(25).toISOString(), score: 350 },
        ],
      },
    ]);
  });
});

describe('live scoreboard', () => {
  async function startRealtimeServer() {
    const server = createServer(createApp());
    createRealtime(server, { snapshot: scoreboardSnapshot });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${port}`,
      async close() {
        await closeRealtime();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  const nextScoreboard = (socket: Socket) =>
    new Promise<ScoreboardBody>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no UPDATE_SCOREBOARD within 5s')), 5000);
      socket.once(SCOREBOARD_EVENT, (payload: ScoreboardBody) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  it('sends the standings on connect and pushes an update on every solve', async () => {
    const admin = await createUser('admin');
    const event = await createEvent(admin.id, EVENT_WINDOW);
    const challenge = await createChallenge(event.id, { flag: 'CTF{live}', initialPoints: 250, minPoints: 250 });
    const player = await createUser();
    await api()
      .post(`/api/events/${event.id}/teams`)
      .set('Authorization', player.token)
      .send({ name: 'On Air' })
      .expect(201);

    const server = await startRealtimeServer();
    const socket = connect(server.url, { query: { eventId: event.id }, transports: ['websocket'] });
    try {
      const onConnect = await nextScoreboard(socket);
      expect(onConnect.teams).toEqual([expect.objectContaining({ name: 'On Air', score: 0 })]);

      const pushed = nextScoreboard(socket);
      await api()
        .post(`/api/events/${event.id}/challenges/${challenge.id}/submissions`)
        .set('Authorization', player.token)
        .send({ flag: 'CTF{live}' })
        .expect(200);

      const update = await pushed;
      expect(update.teams[0]).toMatchObject({ rank: 1, name: 'On Air', score: 250, solves: 1 });
    } finally {
      socket.close();
      await server.close();
    }
  });

  it('turns away a connection without a valid event', async () => {
    const server = await startRealtimeServer();
    const socket = connect(server.url, { query: { eventId: 'not-a-uuid' }, transports: ['websocket'] });
    try {
      const message = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no rejection within 5s')), 5000);
        socket.once('subscribe_error', (text: string) => {
          clearTimeout(timer);
          resolve(text);
        });
      });
      expect(message).toMatch(/eventId/);
    } finally {
      socket.close();
      await server.close();
    }
  });
});
