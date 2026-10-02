import { randomBytes } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { teamMembers, teams, users } from '../db/schema.js';
import { HttpError, isUniqueViolation, notFound } from '../lib/errors.js';
import { currentUser, requireAuth, requireRole } from '../middleware/auth.js';
import { eventIdParam, eventPhase, findEvent, findMembership } from '../services/events.js';

/** Mounted at /api/events/:eventId/teams. Players must be on a team to submit flags. */
export const teamsRouter = Router({ mergeParams: true });

teamsRouter.use(requireAuth, requireRole('player'));

const createTeamBody = z.object({ name: z.string().trim().min(2).max(48) });
const joinTeamBody = z.object({ inviteCode: z.string().trim().min(1).max(32) });

const ALREADY_ON_TEAM = 'You are already on a team for this event';

async function openEvent(rawEventId: unknown) {
  const event = await findEvent(rawEventId);
  if (eventPhase(event) === 'ended') throw new HttpError(403, 'This event has ended');
  return event;
}

teamsRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  const event = await openEvent(eventIdParam(req));
  const { name } = createTeamBody.parse(req.body);

  try {
    const team = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(teams)
        .values({ eventId: event.id, name, inviteCode: randomBytes(9).toString('base64url') })
        .returning({ id: teams.id, name: teams.name, inviteCode: teams.inviteCode });
      await tx.insert(teamMembers).values({ eventId: event.id, teamId: created!.id, userId: user.id });
      return created!;
    });
    res.status(201).json({ team });
  } catch (err) {
    if (isUniqueViolation(err, 'team_members_pkey')) throw new HttpError(409, ALREADY_ON_TEAM);
    if (isUniqueViolation(err, 'teams_event_name_lower_idx')) throw new HttpError(409, 'Team name is taken');
    throw err;
  }
});

teamsRouter.post('/join', async (req, res) => {
  const user = currentUser(req);
  const event = await openEvent(eventIdParam(req));
  const { inviteCode } = joinTeamBody.parse(req.body);

  const [team] = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.eventId, event.id), eq(teams.inviteCode, inviteCode)));
  if (!team) throw new HttpError(404, 'Invalid invite code');

  try {
    await db.insert(teamMembers).values({ eventId: event.id, teamId: team.id, userId: user.id });
  } catch (err) {
    if (isUniqueViolation(err, 'team_members_pkey')) throw new HttpError(409, ALREADY_ON_TEAM);
    throw err;
  }
  res.json({ team });
});

teamsRouter.get('/me', async (req, res) => {
  const user = currentUser(req);
  const event = await findEvent(eventIdParam(req));
  const membership = await findMembership(event.id, user.id);
  if (!membership) throw notFound('Team membership');

  const [team] = await db
    .select({ id: teams.id, name: teams.name, inviteCode: teams.inviteCode })
    .from(teams)
    .where(eq(teams.id, membership.teamId));
  const members = await db
    .select({ id: users.id, username: users.username, joinedAt: teamMembers.joinedAt })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, membership.teamId))
    .orderBy(asc(teamMembers.joinedAt));

  res.json({ team: { ...team, members } });
});
