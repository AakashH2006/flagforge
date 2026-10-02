import { asc } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client.js';
import { events } from '../db/schema.js';
import { eventPhase, findEvent, publicEventColumns } from '../services/events.js';

/** Public event info, so players can find an event before signing in. */
export const eventsRouter = Router();

eventsRouter.get('/', async (_req, res) => {
  const rows = await db.select(publicEventColumns).from(events).orderBy(asc(events.startsAt));
  res.json({ events: rows.map((event) => ({ ...event, phase: eventPhase(event) })) });
});

eventsRouter.get('/:eventId', async (req, res) => {
  const event = await findEvent(req.params.eventId);
  res.json({ event: { ...event, phase: eventPhase(event) } });
});
