import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/errors.js';
import { eventIdParam, eventPhase, findEvent } from '../services/events.js';
import { getScoreboard, scoreboardHistory } from '../services/scoreboard.js';

/**
 * Mounted at /api/events/:eventId/scoreboard. Public: spectators watch a CTF without an account,
 * and the standings give nothing away that the challenge list doesn't. Nothing here reads
 * Postgres on the hot path — the standings come out of the Redis snapshot.
 */
export const scoreboardRouter = Router({ mergeParams: true });

const limitParam = z.coerce.number().int().positive().optional();

async function startedEvent(req: { params: object }) {
  const event = await findEvent(eventIdParam(req));
  if (eventPhase(event) === 'upcoming') throw new HttpError(403, 'This event has not started yet');
  return event;
}

scoreboardRouter.get('/', async (req, res) => {
  const event = await startedEvent(req);
  const limit = limitParam.parse(req.query.limit);
  res.json(await getScoreboard(event.id, event.startsAt, { limit }));
});

/** One running total per team, for the rank-over-time graph. Top teams only by default. */
scoreboardRouter.get('/history', async (req, res) => {
  const event = await startedEvent(req);
  const limit = limitParam.parse(req.query.limit);
  res.json(await scoreboardHistory(event.id, event.startsAt, { limit }));
});
