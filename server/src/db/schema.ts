import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['admin', 'player']);

export const challengeCategory = pgEnum('challenge_category', [
  'web',
  'crypto',
  'pwn',
  'forensics',
  'reverse',
  'misc',
]);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: varchar('username', { length: 32 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('player'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('users_username_lower_idx').on(sql`lower(${t.username})`),
    uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`),
  ],
);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('events_ends_after_starts', sql`${t.endsAt} > ${t.startsAt}`),
    index('events_created_by_idx').on(t.createdBy),
  ],
);

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 48 }).notNull(),
    inviteCode: varchar('invite_code', { length: 32 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // Target for composite foreign keys, so rows pointing at a team must also agree on its event.
    unique('teams_id_event_id_key').on(t.id, t.eventId),
    uniqueIndex('teams_event_name_lower_idx').on(t.eventId, sql`lower(${t.name})`),
    uniqueIndex('teams_invite_code_idx').on(t.inviteCode),
  ],
);

export const teamMembers = pgTable(
  'team_members',
  {
    eventId: uuid('event_id').notNull(),
    teamId: uuid('team_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A user can be on at most one team per event.
    primaryKey({ name: 'team_members_pkey', columns: [t.eventId, t.userId] }),
    foreignKey({
      name: 'team_members_team_fk',
      columns: [t.teamId, t.eventId],
      foreignColumns: [teams.id, teams.eventId],
    }).onDelete('cascade'),
    index('team_members_team_idx').on(t.teamId),
  ],
);

export const challenges = pgTable(
  'challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 120 }).notNull(),
    description: text('description').notNull().default(''),
    category: challengeCategory('category').notNull(),
    // HMAC-SHA256 of the flag, hex-encoded. The plaintext flag is never stored.
    flagHash: varchar('flag_hash', { length: 64 }).notNull(),
    isHidden: boolean('is_hidden').notNull().default(true),
    // Dynamic scoring. A challenge is worth `initialPoints` until teams start solving it, and
    // slides towards `minPoints` as the solve count approaches `decay`. See lib/scoring.ts.
    initialPoints: integer('initial_points').notNull().default(500),
    minPoints: integer('min_points').notNull().default(100),
    decay: integer('decay').notNull().default(25),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('challenges_id_event_id_key').on(t.id, t.eventId),
    uniqueIndex('challenges_event_title_lower_idx').on(t.eventId, sql`lower(${t.title})`),
    check('challenges_points_range', sql`${t.initialPoints} between 1 and 10000 and ${t.minPoints} between 0 and ${t.initialPoints}`),
    check('challenges_decay_positive', sql`${t.decay} >= 1`),
  ],
);

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull(),
    challengeId: uuid('challenge_id').notNull(),
    teamId: uuid('team_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    isCorrect: boolean('is_correct').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'submissions_challenge_fk',
      columns: [t.challengeId, t.eventId],
      foreignColumns: [challenges.id, challenges.eventId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'submissions_team_fk',
      columns: [t.teamId, t.eventId],
      foreignColumns: [teams.id, teams.eventId],
    }).onDelete('cascade'),
    // A team can solve a challenge only once, even when teammates submit at the same moment.
    uniqueIndex('submissions_one_solve_per_team_idx')
      .on(t.teamId, t.challengeId)
      .where(sql`${t.isCorrect}`),
    index('submissions_event_submitted_at_idx').on(t.eventId, t.submittedAt),
    index('submissions_challenge_idx').on(t.challengeId),
  ],
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull(),
    challengeId: uuid('challenge_id').notNull(),
    // The name players download the file as. The organizer chooses it, so it never reaches the
    // filesystem: the bytes are stored under `storageKey`, which the server generates.
    filename: varchar('filename', { length: 200 }).notNull(),
    storageKey: varchar('storage_key', { length: 64 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'attachments_challenge_fk',
      columns: [t.challengeId, t.eventId],
      foreignColumns: [challenges.id, challenges.eventId],
    }).onDelete('cascade'),
    uniqueIndex('attachments_storage_key_idx').on(t.storageKey),
    // Two files called `chall.zip` on one challenge would be indistinguishable in the dialog.
    uniqueIndex('attachments_challenge_filename_lower_idx').on(t.challengeId, sql`lower(${t.filename})`),
    index('attachments_challenge_idx').on(t.challengeId),
  ],
);
