import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { challengeCategory, challenges, submissions, teams } from '../db/schema.js';
import { challengePoints, rankScore } from '../lib/scoring.js';
import { emitScoreboard } from '../realtime.js';
import { redis } from '../redis.js';
import { eventPhase, findEvent } from './events.js';

/**
 * The leaderboard lives in Redis. In the last minutes of a CTF the scoreboard is the most
 * requested page there is, and recomputing every team's points from `submissions` on each request
 * does not hold up. Instead a solve rebuilds the snapshot once and stores it as:
 *
 *   scoreboard:<eventId>:rank   sorted set, teamId -> packed score (see lib/scoring.ts)
 *   scoreboard:<eventId>:teams  hash, teamId -> the team's row as JSON
 *   scoreboard:<eventId>:meta   the challenge values, team count and revision
 *
 * Reads are then a ZREVRANGE for the page of ranks plus one HMGET, and never touch Postgres.
 * Postgres stays the source of truth: the cache expires, and any read can rebuild it.
 */

export type ScoreboardTeam = {
  rank: number;
  teamId: string;
  name: string;
  score: number;
  solves: number;
  firstBloods: number;
  lastSolveAt: string | null;
};

export type ScoreboardChallenge = {
  id: string;
  title: string;
  category: (typeof challengeCategory.enumValues)[number];
  points: number;
  solves: number;
  firstBlood: { teamId: string; name: string; solvedAt: string } | null;
};

export type Scoreboard = {
  eventId: string;
  updatedAt: string;
  totalTeams: number;
  teams: ScoreboardTeam[];
  challenges: ScoreboardChallenge[];
};

type Meta = { rev: number; updatedAt: string; totalTeams: number; challenges: ScoreboardChallenge[] };

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const keys = (eventId: string) => ({
  rank: `scoreboard:${eventId}:rank`,
  teams: `scoreboard:${eventId}:teams`,
  meta: `scoreboard:${eventId}:meta`,
  rev: `scoreboard:${eventId}:rev`,
});

/**
 * Replaces the snapshot, unless a newer one is already stored. Deleting and rewriting the keys in
 * one script means readers never see half a leaderboard, and a rebuild that started earlier but
 * finished later can't overwrite fresher numbers.
 */
const WRITE_SNAPSHOT = `
local meta = redis.call('GET', KEYS[1])
if meta then
  local ok, decoded = pcall(cjson.decode, meta)
  if ok and decoded.rev and tonumber(decoded.rev) > tonumber(ARGV[1]) then return 0 end
end
redis.call('DEL', KEYS[2], KEYS[3])
for i = 4, #ARGV, 3 do
  redis.call('ZADD', KEYS[2], tonumber(ARGV[i + 1]), ARGV[i])
  redis.call('HSET', KEYS[3], ARGV[i], ARGV[i + 2])
end
redis.call('SET', KEYS[1], ARGV[2], 'PX', tonumber(ARGV[3]))
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[3]))
redis.call('PEXPIRE', KEYS[3], tonumber(ARGV[3]))
return 1
`;

/** Reads every published challenge, every solve and every team for one event. */
async function loadEventState(eventId: string) {
  const [challengeRows, solveRows, teamRows] = await Promise.all([
    db
      .select({
        id: challenges.id,
        title: challenges.title,
        category: challenges.category,
        initialPoints: challenges.initialPoints,
        minPoints: challenges.minPoints,
        decay: challenges.decay,
      })
      .from(challenges)
      .where(and(eq(challenges.eventId, eventId), eq(challenges.isHidden, false)))
      .orderBy(asc(challenges.category), asc(challenges.title)),
    db
      .select({
        challengeId: submissions.challengeId,
        teamId: submissions.teamId,
        submittedAt: submissions.submittedAt,
      })
      .from(submissions)
      .innerJoin(challenges, and(eq(challenges.id, submissions.challengeId), eq(challenges.isHidden, false)))
      .where(and(eq(submissions.eventId, eventId), eq(submissions.isCorrect, true)))
      .orderBy(asc(submissions.submittedAt), asc(submissions.id)),
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.eventId, eventId))
      .orderBy(asc(teams.name)),
  ]);

  return { challengeRows, solveRows, teamRows };
}

/** Standard competition ranking: equal scores share a rank, and the next one skips ahead. */
function assignRanks(rows: Omit<ScoreboardTeam, 'rank'>[], rankScores: number[]): ScoreboardTeam[] {
  let rank = 0;
  let previous: number | undefined;
  return rows.map((row, index) => {
    if (rankScores[index] !== previous) {
      rank = index + 1;
      previous = rankScores[index];
    }
    return { rank, ...row };
  });
}

/** Recomputes the whole leaderboard for an event from Postgres. */
export async function computeScoreboard(eventId: string, eventStartsAt: Date) {
  const { challengeRows, solveRows, teamRows } = await loadEventState(eventId);

  const solveCounts = new Map<string, number>();
  const firstSolves = new Map<string, { teamId: string; submittedAt: Date }>();
  for (const solve of solveRows) {
    solveCounts.set(solve.challengeId, (solveCounts.get(solve.challengeId) ?? 0) + 1);
    if (!firstSolves.has(solve.challengeId)) firstSolves.set(solve.challengeId, solve);
  }

  const teamNames = new Map(teamRows.map((team) => [team.id, team.name]));
  const points = new Map<string, number>();
  const challengeStats: ScoreboardChallenge[] = challengeRows.map((challenge) => {
    const solves = solveCounts.get(challenge.id) ?? 0;
    const value = challengePoints(challenge, solves);
    points.set(challenge.id, value);
    const first = firstSolves.get(challenge.id);
    return {
      id: challenge.id,
      title: challenge.title,
      category: challenge.category,
      points: value,
      solves,
      firstBlood: first
        ? {
            teamId: first.teamId,
            name: teamNames.get(first.teamId) ?? 'Unknown team',
            solvedAt: first.submittedAt.toISOString(),
          }
        : null,
    };
  });

  const totals = new Map<string, { score: number; solves: number; firstBloods: number; lastSolveAt: Date | null }>(
    teamRows.map((team) => [team.id, { score: 0, solves: 0, firstBloods: 0, lastSolveAt: null }]),
  );
  for (const solve of solveRows) {
    const total = totals.get(solve.teamId);
    // A team deleted mid-event leaves its solves behind; they no longer belong to anyone.
    if (!total) continue;
    total.score += points.get(solve.challengeId) ?? 0;
    total.solves += 1;
    if (firstSolves.get(solve.challengeId)?.teamId === solve.teamId) total.firstBloods += 1;
    if (!total.lastSolveAt || solve.submittedAt > total.lastSolveAt) total.lastSolveAt = solve.submittedAt;
  }

  const ordered = teamRows
    .map((team) => {
      const total = totals.get(team.id)!;
      return {
        teamId: team.id,
        name: team.name,
        rankScore: rankScore(total.score, total.lastSolveAt, eventStartsAt),
        row: {
          teamId: team.id,
          name: team.name,
          score: total.score,
          solves: total.solves,
          firstBloods: total.firstBloods,
          lastSolveAt: total.lastSolveAt?.toISOString() ?? null,
        },
      };
    })
    // teamRows already come back sorted by name, so equal scores stay in a stable, readable order.
    .sort((a, b) => b.rankScore - a.rankScore);

  return {
    teams: assignRanks(
      ordered.map((entry) => entry.row),
      ordered.map((entry) => entry.rankScore),
    ),
    rankScores: ordered.map((entry) => entry.rankScore),
    challenges: challengeStats,
  };
}

/** Recomputes the leaderboard and stores it in Redis. Returns the fresh snapshot. */
async function rebuild(eventId: string, eventStartsAt: Date): Promise<Scoreboard> {
  // Claimed before reading Postgres, so a rebuild that reads older data also carries a lower
  // revision and loses to the newer snapshot in the write script.
  const rev = await redis.incr(keys(eventId).rev);
  const { teams: rows, rankScores, challenges: challengeStats } = await computeScoreboard(eventId, eventStartsAt);

  const meta: Meta = {
    rev,
    updatedAt: new Date().toISOString(),
    totalTeams: rows.length,
    challenges: challengeStats,
  };

  const key = keys(eventId);
  const args: (string | number)[] = [rev, JSON.stringify(meta), CACHE_TTL_MS];
  rows.forEach((row, index) => {
    const { rank: _rank, ...entry } = row;
    args.push(row.teamId, rankScores[index]!, JSON.stringify(entry));
  });
  await redis.eval(WRITE_SNAPSHOT, 3, key.meta, key.rank, key.teams, ...args);

  return {
    eventId,
    updatedAt: meta.updatedAt,
    totalTeams: meta.totalTeams,
    teams: rows.slice(0, DEFAULT_LIMIT),
    challenges: challengeStats,
  };
}

/** Reads a page of the leaderboard out of Redis, rebuilding it first if the cache is cold. */
export async function getScoreboard(
  eventId: string,
  eventStartsAt: Date,
  options: { limit?: number } = {},
): Promise<Scoreboard> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, options.limit ?? DEFAULT_LIMIT));
  const key = keys(eventId);

  const raw = await redis.get(key.meta);
  if (!raw) {
    const fresh = await rebuild(eventId, eventStartsAt);
    return { ...fresh, teams: fresh.teams.slice(0, limit) };
  }

  const meta = JSON.parse(raw) as Meta;
  // The sorted set does the ranking; the hash holds the rows to show for that page of ranks.
  const ranked = await redis.zrevrange(key.rank, 0, limit - 1, 'WITHSCORES');
  const ids = ranked.filter((_, index) => index % 2 === 0);
  const rankScores = ranked.filter((_, index) => index % 2 === 1).map(Number);
  const stored = ids.length > 0 ? await redis.hmget(key.teams, ...ids) : [];

  const rows: Omit<ScoreboardTeam, 'rank'>[] = [];
  const scores: number[] = [];
  stored.forEach((entry, index) => {
    if (entry === null) return;
    rows.push(JSON.parse(entry) as Omit<ScoreboardTeam, 'rank'>);
    scores.push(rankScores[index]!);
  });

  return {
    eventId,
    updatedAt: meta.updatedAt,
    totalTeams: meta.totalTeams,
    teams: assignRanks(rows, scores),
    challenges: meta.challenges,
  };
}

// One rebuild at a time per event within this process, so two solves landing together produce two
// snapshots in order instead of racing each other through Postgres and Redis.
const pending = new Map<string, Promise<Scoreboard>>();

function queueRebuild(eventId: string, eventStartsAt: Date): Promise<Scoreboard> {
  const next = (pending.get(eventId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => rebuild(eventId, eventStartsAt));
  pending.set(eventId, next);
  void next.catch(() => undefined).finally(() => {
    if (pending.get(eventId) === next) pending.delete(eventId);
  });
  return next;
}

/**
 * Rebuilds the leaderboard and pushes it to everyone watching the event. Called after anything
 * that can move scores: a correct flag, or an organizer changing a challenge.
 */
export async function publishScoreboard(eventId: string, eventStartsAt: Date): Promise<Scoreboard> {
  const scoreboard = await queueRebuild(eventId, eventStartsAt);
  emitScoreboard(eventId, scoreboard);
  return scoreboard;
}

/** Same, but for callers that must not fail because Redis is unreachable. */
export function publishScoreboardSoon(eventId: string, eventStartsAt: Date): void {
  void publishScoreboard(eventId, eventStartsAt).catch((err: unknown) => {
    console.error(`Failed to update the scoreboard for event ${eventId}:`, err);
  });
}

/** Drops the cached snapshot. The next read rebuilds it. */
export async function invalidateScoreboard(eventId: string): Promise<void> {
  const key = keys(eventId);
  await redis.del(key.meta, key.rank, key.teams);
}

/**
 * The standings a socket client gets on connect. Returns null for an event that doesn't exist or
 * hasn't started, matching what the HTTP route would answer.
 */
export async function scoreboardSnapshot(eventId: string): Promise<Scoreboard | null> {
  const event = await findEvent(eventId).catch(() => null);
  if (!event || eventPhase(event) === 'upcoming') return null;
  return getScoreboard(event.id, event.startsAt);
}

export type ScoreboardHistory = {
  eventId: string;
  teams: { teamId: string; name: string; points: { at: string; score: number }[] }[];
};

/**
 * The rank-over-time graph: one running total per team, one point per solve.
 *
 * Solves are worth what they are worth *now*, so the lines only ever climb. Replaying each
 * challenge's value as it changed through the event would make lines dip when someone else solved
 * something, which reads as a bug rather than as scoring.
 */
export async function scoreboardHistory(
  eventId: string,
  eventStartsAt: Date,
  options: { limit?: number } = {},
): Promise<ScoreboardHistory> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 10));
  const [{ teams: ranked }, { challengeRows, solveRows }] = await Promise.all([
    getScoreboard(eventId, eventStartsAt, { limit }),
    loadEventState(eventId),
  ]);

  const solveCounts = new Map<string, number>();
  for (const solve of solveRows) solveCounts.set(solve.challengeId, (solveCounts.get(solve.challengeId) ?? 0) + 1);
  const points = new Map(
    challengeRows.map((challenge) => [challenge.id, challengePoints(challenge, solveCounts.get(challenge.id) ?? 0)]),
  );

  const running = new Map(ranked.map((team) => [team.teamId, { team, score: 0, points: [] as { at: string; score: number }[] }]));
  for (const solve of solveRows) {
    const entry = running.get(solve.teamId);
    if (!entry) continue;
    entry.score += points.get(solve.challengeId) ?? 0;
    entry.points.push({ at: solve.submittedAt.toISOString(), score: entry.score });
  }

  return {
    eventId,
    teams: ranked.map((team) => ({
      teamId: team.teamId,
      name: team.name,
      points: running.get(team.teamId)?.points ?? [],
    })),
  };
}
