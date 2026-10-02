import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { events, teamMembers } from '../db/schema.js';
import { notFound, parseId } from '../lib/errors.js';

export type EventPhase = 'upcoming' | 'live' | 'ended';

export const publicEventColumns = {
  id: events.id,
  name: events.name,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
};

/** Reads `:eventId` from a parent route. Express types don't include merged params. */
export const eventIdParam = (req: { params: object }): unknown => (req.params as { eventId?: unknown }).eventId;

export async function findEvent(rawEventId: unknown) {
  const eventId = parseId(rawEventId, 'Event');
  const [event] = await db.select(publicEventColumns).from(events).where(eq(events.id, eventId));
  if (!event) throw notFound('Event');
  return event;
}

export function eventPhase(event: { startsAt: Date; endsAt: Date }, now = new Date()): EventPhase {
  if (now < event.startsAt) return 'upcoming';
  if (now >= event.endsAt) return 'ended';
  return 'live';
}

export async function findMembership(eventId: string, userId: string) {
  const [membership] = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.eventId, eventId), eq(teamMembers.userId, userId)));
  return membership;
}
