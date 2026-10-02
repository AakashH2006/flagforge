import { and, asc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { challenges, submissions } from '../db/schema.js';
import { HttpError, notFound, parseId } from '../lib/errors.js';
import { verifyFlag } from '../lib/flags.js';
import { challengePoints } from '../lib/scoring.js';
import { currentUser, requireAuth, requireRole } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { attachmentsByChallenge, sendAttachment } from '../services/attachments.js';
import { eventIdParam, eventPhase, findEvent, findMembership } from '../services/events.js';
import { publishScoreboard } from '../services/scoreboard.js';

/** Mounted at /api/events/:eventId/challenges. The player-facing challenge list and flag submission. */
export const challengesRouter = Router({ mergeParams: true });

challengesRouter.use(requireAuth, requireRole('player'));

const submitBody = z.object({ flag: z.string().min(1).max(256) });

// Limited per user, and applied before any database work, so a script guessing flags
// gets cut off without hitting Postgres.
const flagLimit = rateLimit({
  name: 'flag',
  limit: env.FLAG_RATE_LIMIT_MAX,
  windowSeconds: env.FLAG_RATE_LIMIT_WINDOW_SECONDS,
  key: (req) => currentUser(req).id,
});

export type SubmissionResult = 'correct' | 'incorrect' | 'already_solved';

challengesRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const event = await findEvent(eventIdParam(req));
  if (eventPhase(event) === 'upcoming') throw new HttpError(403, 'This event has not started yet');

  const membership = await findMembership(event.id, user.id);
  const files = await attachmentsByChallenge(event.id);
  const rows = await db
    .select({
      id: challenges.id,
      title: challenges.title,
      description: challenges.description,
      category: challenges.category,
      initialPoints: challenges.initialPoints,
      minPoints: challenges.minPoints,
      decay: challenges.decay,
      // What a challenge is worth depends on how many teams have solved it.
      solves: sql<number>`(
        select count(*)::int from ${submissions}
        where ${submissions.challengeId} = ${challenges.id} and ${submissions.isCorrect}
      )`,
      solvedAt: submissions.submittedAt,
    })
    .from(challenges)
    .leftJoin(
      submissions,
      and(
        eq(submissions.challengeId, challenges.id),
        eq(submissions.isCorrect, true),
        membership ? eq(submissions.teamId, membership.teamId) : sql`false`,
      ),
    )
    .where(and(eq(challenges.eventId, event.id), eq(challenges.isHidden, false)))
    .orderBy(asc(challenges.category), asc(challenges.title));

  res.json({
    challenges: rows.map(({ solvedAt, initialPoints, minPoints, decay, ...challenge }) => ({
      ...challenge,
      points: challengePoints({ initialPoints, minPoints, decay }, challenge.solves),
      attachments: files.get(challenge.id) ?? [],
      solved: solvedAt !== null,
      solvedAt,
    })),
  });
});

/**
 * Downloads a challenge file. Published challenges only, and only once the event has started,
 * so attachments can't be pulled early or out of a draft.
 */
challengesRouter.get('/:challengeId/attachments/:attachmentId', async (req, res) => {
  const event = await findEvent(eventIdParam(req));
  if (eventPhase(event) === 'upcoming') throw new HttpError(403, 'This event has not started yet');

  const challengeId = parseId(req.params.challengeId, 'Challenge');
  const [challenge] = await db
    .select({ id: challenges.id })
    .from(challenges)
    .where(and(eq(challenges.id, challengeId), eq(challenges.eventId, event.id), eq(challenges.isHidden, false)));
  if (!challenge) throw notFound('Challenge');

  await sendAttachment(res, challenge.id, req.params.attachmentId);
});

challengesRouter.post('/:challengeId/submissions', flagLimit, async (req, res) => {
  const user = currentUser(req);
  const { flag } = submitBody.parse(req.body);
  const challengeId = parseId(req.params.challengeId, 'Challenge');
  const event = await findEvent(eventIdParam(req));

  const phase = eventPhase(event);
  if (phase === 'upcoming') throw new HttpError(403, 'This event has not started yet');
  if (phase === 'ended') throw new HttpError(403, 'This event has ended');

  const [challenge] = await db
    .select({ id: challenges.id, flagHash: challenges.flagHash })
    .from(challenges)
    .where(and(eq(challenges.id, challengeId), eq(challenges.eventId, event.id), eq(challenges.isHidden, false)));
  if (!challenge) throw notFound('Challenge');

  const membership = await findMembership(event.id, user.id);
  if (!membership) throw new HttpError(403, 'Join or create a team before submitting flags');

  const respond = (result: SubmissionResult, points?: number) => res.json({ result, points });

  const [existingSolve] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(
      and(
        eq(submissions.teamId, membership.teamId),
        eq(submissions.challengeId, challenge.id),
        eq(submissions.isCorrect, true),
      ),
    )
    .limit(1);
  if (existingSolve) return respond('already_solved');

  const isCorrect = verifyFlag(flag, challenge.flagHash);
  // If two teammates submit the correct flag at once, the partial unique index keeps only one
  // solve and the other insert does nothing.
  const inserted = await db
    .insert(submissions)
    .values({ eventId: event.id, challengeId: challenge.id, teamId: membership.teamId, userId: user.id, isCorrect })
    .onConflictDoNothing()
    .returning({ id: submissions.id });
  if (inserted.length === 0) return respond('already_solved');
  if (!isCorrect) return respond('incorrect');

  // The solve changes this team's total and, through dynamic scoring, everyone else's. Rebuild the
  // leaderboard and push it to every client watching the event before answering, so the number the
  // solver sees is the one on the scoreboard.
  // A scoreboard that can't be rebuilt must not lose someone their solve, which is already
  // committed. The next solve, or the cache expiring, puts the standings right.
  const scoreboard = await publishScoreboard(event.id, event.startsAt).catch((err: unknown) => {
    console.error(`Failed to update the scoreboard for event ${event.id}:`, err);
    return null;
  });
  respond('correct', scoreboard?.challenges.find((entry) => entry.id === challenge.id)?.points);
});
