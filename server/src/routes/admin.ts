import { and, asc, desc, eq } from 'drizzle-orm';
import { type Request, Router } from 'express';
import { z } from 'zod';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { attachments, challengeCategory, challenges, events } from '../db/schema.js';
import { HttpError, isUniqueViolation, notFound, parseId } from '../lib/errors.js';
import { hashFlag } from '../lib/flags.js';
import { currentUser, requireAuth, requireRole } from '../middleware/auth.js';
import {
  attachmentColumns,
  attachmentsByChallenge,
  countAttachments,
  listAttachments,
  receiveUpload,
  removeStoredFiles,
  safeFilename,
  sendAttachment,
  storageKeysForChallenge,
  storageKeysForEvent,
} from '../services/attachments.js';
import { invalidateScoreboard, publishScoreboardSoon } from '../services/scoreboard.js';

/**
 * Organizer API. Every route requires the admin role, and organizers can only see and change
 * their own events. Someone else's event returns 404, so its existence isn't revealed.
 * Responses never include flags or flag hashes.
 */
export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('admin'));

const isoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const eventFields = {
  name: z.string().trim().min(1).max(120),
  startsAt: isoDate,
  endsAt: isoDate,
};
const createEventBody = z
  .object(eventFields)
  .refine((body) => body.endsAt > body.startsAt, { message: 'endsAt must be after startsAt', path: ['endsAt'] });
const updateEventBody = z.object(eventFields).partial();

const challengeFields = {
  title: z.string().trim().min(1).max(120),
  description: z.string().max(20_000),
  category: z.enum(challengeCategory.enumValues),
  flag: z.string().trim().min(1).max(256),
  isHidden: z.boolean(),
  // Dynamic scoring, explained in lib/scoring.ts. Set minPoints equal to initialPoints for a
  // challenge that is always worth the same.
  initialPoints: z.coerce.number().int().min(1).max(10_000),
  minPoints: z.coerce.number().int().min(0),
  decay: z.coerce.number().int().min(1).max(10_000),
};

const pointsInRange = (body: { initialPoints?: number; minPoints?: number }) =>
  body.minPoints === undefined || body.initialPoints === undefined || body.minPoints <= body.initialPoints;
const POINTS_ORDER = { message: 'minPoints must not be above initialPoints', path: ['minPoints'] };

// New challenges are hidden until the organizer publishes them.
const createChallengeBody = z
  .object({
    ...challengeFields,
    description: challengeFields.description.default(''),
    isHidden: challengeFields.isHidden.default(true),
    initialPoints: challengeFields.initialPoints.default(500),
    minPoints: challengeFields.minPoints.default(100),
    decay: challengeFields.decay.default(25),
  })
  .refine(pointsInRange, POINTS_ORDER);
// No defaults here, so a partial update can't reset fields it didn't mention.
const updateChallengeBody = z.object(challengeFields).partial();

const adminEventColumns = {
  id: events.id,
  name: events.name,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  createdAt: events.createdAt,
  updatedAt: events.updatedAt,
};

const adminChallengeColumns = {
  id: challenges.id,
  eventId: challenges.eventId,
  title: challenges.title,
  description: challenges.description,
  category: challenges.category,
  isHidden: challenges.isHidden,
  initialPoints: challenges.initialPoints,
  minPoints: challenges.minPoints,
  decay: challenges.decay,
  createdAt: challenges.createdAt,
  updatedAt: challenges.updatedAt,
};

const DUPLICATE_TITLE = 'A challenge with this title already exists in this event';

async function findOwnedEvent(rawEventId: unknown, userId: string) {
  const eventId = parseId(rawEventId, 'Event');
  const [event] = await db
    .select(adminEventColumns)
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.createdBy, userId)));
  if (!event) throw notFound('Event');
  return event;
}

type OwnedEvent = Awaited<ReturnType<typeof findOwnedEvent>>;

async function findChallenge(event: OwnedEvent, rawChallengeId: unknown) {
  const challengeId = parseId(rawChallengeId, 'Challenge');
  const [challenge] = await db
    .select(adminChallengeColumns)
    .from(challenges)
    .where(and(eq(challenges.id, challengeId), eq(challenges.eventId, event.id)));
  if (!challenge) throw notFound('Challenge');
  return challenge;
}

// ---- Events ----

adminRouter.get('/events', async (req, res) => {
  const rows = await db
    .select(adminEventColumns)
    .from(events)
    .where(eq(events.createdBy, currentUser(req).id))
    .orderBy(desc(events.startsAt));
  res.json({ events: rows });
});

adminRouter.post('/events', async (req, res) => {
  const body = createEventBody.parse(req.body);
  const [event] = await db
    .insert(events)
    .values({ ...body, createdBy: currentUser(req).id })
    .returning(adminEventColumns);
  res.status(201).json({ event });
});

adminRouter.get('/events/:eventId', async (req, res) => {
  res.json({ event: await findOwnedEvent(req.params.eventId, currentUser(req).id) });
});

adminRouter.patch('/events/:eventId', async (req, res) => {
  const existing = await findOwnedEvent(req.params.eventId, currentUser(req).id);
  const body = updateEventBody.parse(req.body);
  if (Object.keys(body).length === 0) {
    res.json({ event: existing });
    return;
  }

  const startsAt = body.startsAt ?? existing.startsAt;
  const endsAt = body.endsAt ?? existing.endsAt;
  if (endsAt <= startsAt) throw new HttpError(400, 'endsAt must be after startsAt');

  const [event] = await db.update(events).set(body).where(eq(events.id, existing.id)).returning(adminEventColumns);
  // Ties are broken on time since the start, so moving the window re-orders level teams.
  publishScoreboardSoon(event!.id, event!.startsAt);
  res.json({ event });
});

adminRouter.delete('/events/:eventId', async (req, res) => {
  const event = await findOwnedEvent(req.params.eventId, currentUser(req).id);
  // Read the keys first: deleting the event cascades the rows that name them.
  const storageKeys = await storageKeysForEvent(event.id);
  await db.delete(events).where(eq(events.id, event.id));
  await Promise.all([invalidateScoreboard(event.id), removeStoredFiles(storageKeys)]);
  res.status(204).end();
});

// ---- Challenges ----

adminRouter.get('/events/:eventId/challenges', async (req, res) => {
  const event = await findOwnedEvent(req.params.eventId, currentUser(req).id);
  const [rows, files] = await Promise.all([
    db
      .select(adminChallengeColumns)
      .from(challenges)
      .where(eq(challenges.eventId, event.id))
      .orderBy(asc(challenges.category), asc(challenges.title)),
    attachmentsByChallenge(event.id),
  ]);
  res.json({ challenges: rows.map((row) => ({ ...row, attachments: files.get(row.id) ?? [] })) });
});

adminRouter.post('/events/:eventId/challenges', async (req, res) => {
  const event = await findOwnedEvent(req.params.eventId, currentUser(req).id);
  const { flag, ...fields } = createChallengeBody.parse(req.body);

  try {
    const [challenge] = await db
      .insert(challenges)
      .values({ ...fields, eventId: event.id, flagHash: hashFlag(flag) })
      .returning(adminChallengeColumns);
    publishScoreboardSoon(event.id, event.startsAt);
    res.status(201).json({ challenge });
  } catch (err) {
    if (isUniqueViolation(err, 'challenges_event_title_lower_idx')) throw new HttpError(409, DUPLICATE_TITLE);
    throw err;
  }
});

adminRouter.get('/events/:eventId/challenges/:challengeId', async (req, res) => {
  const event = await findOwnedEvent(req.params.eventId, currentUser(req).id);
  const challenge = await findChallenge(event, req.params.challengeId);
  res.json({ challenge: { ...challenge, attachments: await listAttachments(challenge.id) } });
});

adminRouter.patch('/events/:eventId/challenges/:challengeId', async (req, res) => {
  const event = await findOwnedEvent(req.params.eventId, currentUser(req).id);
  const existing = await findChallenge(event, req.params.challengeId);
  const { flag, ...fields } = updateChallengeBody.parse(req.body);
  const changes = { ...fields, ...(flag !== undefined && { flagHash: hashFlag(flag) }) };
  if (Object.keys(changes).length === 0) {
    res.json({ challenge: existing });
    return;
  }
  // A partial update is checked against the values it leaves alone.
  const points = {
    initialPoints: fields.initialPoints ?? existing.initialPoints,
    minPoints: fields.minPoints ?? existing.minPoints,
  };
  if (!pointsInRange(points)) throw new HttpError(400, POINTS_ORDER.message);

  try {
    const [challenge] = await db
      .update(challenges)
      .set(changes)
      .where(eq(challenges.id, existing.id))
      .returning(adminChallengeColumns);
    publishScoreboardSoon(event.id, event.startsAt);
    res.json({ challenge });
  } catch (err) {
    if (isUniqueViolation(err, 'challenges_event_title_lower_idx')) throw new HttpError(409, DUPLICATE_TITLE);
    throw err;
  }
});

adminRouter.delete('/events/:eventId/challenges/:challengeId', async (req, res) => {
  const event = await findOwnedEvent(req.params.eventId, currentUser(req).id);
  const challenge = await findChallenge(event, req.params.challengeId);
  const storageKeys = await storageKeysForChallenge(challenge.id);
  await db.delete(challenges).where(eq(challenges.id, challenge.id));
  await removeStoredFiles(storageKeys);
  publishScoreboardSoon(event.id, event.startsAt);
  res.status(204).end();
});

// ---- Attachments ----

const ATTACHMENTS_PATH = '/events/:eventId/challenges/:challengeId/attachments';

/** The challenge named by an attachment route, once the event is known to be the caller's. */
async function findChallengeForAttachment(req: Request) {
  const event = await findOwnedEvent(req.params.eventId, currentUser(req).id);
  return findChallenge(event, req.params.challengeId);
}

adminRouter.post(ATTACHMENTS_PATH, receiveUpload, async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'Attach a file in the `file` field');

  try {
    const challenge = await findChallengeForAttachment(req);
    if ((await countAttachments(challenge.id)) >= env.MAX_ATTACHMENTS_PER_CHALLENGE) {
      throw new HttpError(409, `A challenge can hold at most ${env.MAX_ATTACHMENTS_PER_CHALLENGE} attachments`);
    }

    const [attachment] = await db
      .insert(attachments)
      .values({
        eventId: challenge.eventId,
        challengeId: challenge.id,
        filename: safeFilename(file.originalname),
        storageKey: file.filename,
        sizeBytes: file.size,
      })
      .returning(attachmentColumns);
    res.status(201).json({ attachment });
  } catch (err) {
    // multer has already written the bytes. Nothing points at them, so they go back out.
    await removeStoredFiles([file.filename]);
    if (isUniqueViolation(err, 'attachments_challenge_filename_lower_idx')) {
      throw new HttpError(409, 'This challenge already has a file with that name');
    }
    throw err;
  }
});

// Organizers download their own attachments to check what players will get.
adminRouter.get(`${ATTACHMENTS_PATH}/:attachmentId`, async (req, res) => {
  const challenge = await findChallengeForAttachment(req);
  await sendAttachment(res, challenge.id, req.params.attachmentId);
});

adminRouter.delete(`${ATTACHMENTS_PATH}/:attachmentId`, async (req, res) => {
  const challenge = await findChallengeForAttachment(req);
  const attachmentId = parseId(req.params.attachmentId, 'Attachment');
  const deleted = await db
    .delete(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.challengeId, challenge.id)))
    .returning({ storageKey: attachments.storageKey });
  if (deleted.length === 0) throw notFound('Attachment');
  await removeStoredFiles(deleted.map((row) => row.storageKey));
  res.status(204).end();
});
