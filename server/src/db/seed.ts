import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { hashFlag } from '../lib/flags.js';
import { hashPassword } from '../lib/passwords.js';
import { ensureUploadDir, removeStoredFiles, uploadRoot } from '../services/attachments.js';
import { db, pool } from './client.js';
import { attachments, challenges, events, submissions, teamMembers, teams, users } from './schema.js';

/**
 * Creates the demo admin and player accounts and a live "Demo Event" with 5 challenges, plus
 * three rival teams whose solves are spread over the first hour, so the scoreboard and its
 * rank-over-time graph have something to show straight away.
 * You can run it again safely: the accounts are updated and the demo event is rebuilt.
 */

const DEMO_EVENT_NAME = 'Demo Event';

const DEMO_CHALLENGES = [
  {
    title: 'Robots Know Best',
    category: 'web',
    initialPoints: 300,
    minPoints: 100,
    decay: 30,
    description:
      'The admin swears nothing is hidden on this site.\n\nWeb crawlers are told where *not* to look. Maybe you should look there.',
    flag: 'CTF{r0b0ts_txt_1s_n0t_s3cur1ty}',
  },
  {
    title: 'Cookie Monster',
    category: 'web',
    initialPoints: 400,
    minPoints: 125,
    decay: 25,
    description:
      "You're logged in as `guest`. The server trusts whatever your browser says about who you are.\n\nBecome `admin`.",
    flag: 'CTF{n3v3r_trust_th3_cl13nt}',
  },
  {
    title: "Caesar's Salad",
    category: 'crypto',
    initialPoints: 250,
    minPoints: 75,
    decay: 30,
    description: 'Julius left this note behind. He was not very creative with his key.\n\n```\nPGS{ebg13_vf_abg_rapelcgvba}\n```',
    flag: 'CTF{rot13_is_not_encryption}',
  },
  {
    title: 'Base Jumping',
    category: 'crypto',
    initialPoints: 300,
    minPoints: 100,
    decay: 30,
    description:
      'Our intern says this secret is "encrypted".\n\n```\nQ1RGe2I0czNfNjRfMXNfbjB0XzNuY3J5cHQxMG5fMzF0aDNyfQ==\n```',
    flag: 'CTF{b4s3_64_1s_n0t_3ncrypt10n_31th3r}',
  },
  {
    title: 'Packet Whisperer',
    category: 'forensics',
    initialPoints: 500,
    minPoints: 150,
    decay: 20,
    description:
      'We captured traffic from a compromised host. This payload stood out from the rest:\n\n```\n4354467b7768305f6e333364735f77317233736834726b7d\n```',
    flag: 'CTF{wh0_n33ds_w1r3sh4rk}',
  },
] as const;

/**
 * A handout for the forensics challenge, so both clients have a real attachment to show. It is
 * written out by the seed rather than committed, which keeps binary files out of the repo.
 */
const DEMO_ATTACHMENT = {
  challengeTitle: 'Packet Whisperer',
  filename: 'capture-notes.txt',
  contents: [
    'Host 10.0.4.17 -> 198.51.100.9, TCP/4444, 3 packets.',
    '',
    'The operator typed something before the session dropped. Our capture only kept',
    'the payload bytes, which are in the challenge description.',
    '',
    'They were in a hurry, so they did not encrypt anything -- they just made the',
    'bytes look unreadable.',
    '',
  ].join('\n'),
};

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/**
 * Teams the demo player is up against. `solves` are minutes after the event started, so the
 * scoreboard opens with a real race in it: Null Terminators ahead on four solves, and everyone
 * else close enough to catch.
 */
const DEMO_TEAMS = [
  {
    name: 'Null Terminators',
    member: { username: 'rival1', email: 'rival1@example.com' },
    solves: [
      { title: 'Robots Know Best', minute: 5 },
      { title: "Caesar's Salad", minute: 12 },
      { title: 'Base Jumping', minute: 30 },
      { title: 'Cookie Monster', minute: 48 },
    ],
  },
  {
    name: 'Segfault Society',
    member: { username: 'rival2', email: 'rival2@example.com' },
    solves: [
      { title: "Caesar's Salad", minute: 10 },
      { title: 'Robots Know Best', minute: 16 },
      { title: 'Packet Whisperer', minute: 40 },
    ],
  },
  {
    name: 'Kernel Panic',
    member: { username: 'rival3', email: 'rival3@example.com' },
    solves: [
      { title: 'Robots Know Best', minute: 25 },
      { title: 'Base Jumping', minute: 35 },
    ],
  },
] as const;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function upsertUser(
  tx: Tx,
  account: { username: string; email: string; password: string; role: 'admin' | 'player' },
) {
  const passwordHash = await hashPassword(account.password);
  const [existing] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.username})`, account.username.toLowerCase()));

  if (existing) {
    await tx.update(users).set({ passwordHash, role: account.role }).where(eq(users.id, existing.id));
    return existing.id;
  }
  const [created] = await tx
    .insert(users)
    .values({ username: account.username, email: account.email, passwordHash, role: account.role })
    .returning({ id: users.id });
  return created!.id;
}

const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'admin-demo-pass';
const playerPassword = process.env.SEED_PLAYER_PASSWORD ?? 'player-demo-pass';

try {
  await ensureUploadDir();
  // Files belonging to a previous demo event, deleted once the rebuild has committed.
  let staleKeys: string[] = [];

  const eventId = await db.transaction(async (tx) => {
    const adminId = await upsertUser(tx, {
      username: 'admin',
      email: 'admin@example.com',
      password: adminPassword,
      role: 'admin',
    });
    const playerId = await upsertUser(tx, {
      username: 'player',
      email: 'player@example.com',
      password: playerPassword,
      role: 'player',
    });

    // Deleting the event cascades to its challenges, teams, submissions and attachment rows,
    // so the keys of the files those rows name have to be read first.
    const [previous] = await tx
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.name, DEMO_EVENT_NAME), eq(events.createdBy, adminId)));
    if (previous) {
      const stale = await tx
        .select({ storageKey: attachments.storageKey })
        .from(attachments)
        .where(eq(attachments.eventId, previous.id));
      staleKeys = stale.map((row) => row.storageKey);
      await tx.delete(events).where(eq(events.id, previous.id));
    }

    const startsAt = new Date(Date.now() - HOUR);
    const [event] = await tx
      .insert(events)
      .values({
        name: DEMO_EVENT_NAME,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 24 * HOUR),
        createdBy: adminId,
      })
      .returning({ id: events.id });

    const created = await tx
      .insert(challenges)
      .values(
        DEMO_CHALLENGES.map(({ flag, ...challenge }) => ({
          ...challenge,
          eventId: event!.id,
          flagHash: hashFlag(flag),
          isHidden: false,
        })),
      )
      .returning({ id: challenges.id, title: challenges.title });
    const challengeIds = new Map(created.map((challenge) => [challenge.title, challenge.id]));

    const storageKey = randomBytes(16).toString('hex');
    await writeFile(path.join(uploadRoot, storageKey), DEMO_ATTACHMENT.contents);
    await tx.insert(attachments).values({
      eventId: event!.id,
      challengeId: challengeIds.get(DEMO_ATTACHMENT.challengeTitle)!,
      filename: DEMO_ATTACHMENT.filename,
      storageKey,
      sizeBytes: Buffer.byteLength(DEMO_ATTACHMENT.contents),
    });

    const newTeam = (name: string) => ({
      eventId: event!.id,
      name,
      inviteCode: randomBytes(9).toString('base64url'),
    });

    const [team] = await tx.insert(teams).values(newTeam('Demo Team')).returning({ id: teams.id });
    await tx.insert(teamMembers).values({ eventId: event!.id, teamId: team!.id, userId: playerId });

    for (const rival of DEMO_TEAMS) {
      const userId = await upsertUser(tx, { ...rival.member, password: playerPassword, role: 'player' });
      const [rivalTeam] = await tx.insert(teams).values(newTeam(rival.name)).returning({ id: teams.id });
      await tx.insert(teamMembers).values({ eventId: event!.id, teamId: rivalTeam!.id, userId });
      await tx.insert(submissions).values(
        rival.solves.map((solve) => ({
          eventId: event!.id,
          challengeId: challengeIds.get(solve.title)!,
          teamId: rivalTeam!.id,
          userId,
          isCorrect: true,
          submittedAt: new Date(startsAt.getTime() + solve.minute * MINUTE),
        })),
      );
    }

    return event!.id;
  });

  await removeStoredFiles(staleKeys);

  console.log(
    `Seeded "${DEMO_EVENT_NAME}" (${eventId}) with ${DEMO_CHALLENGES.length} challenges` +
      ` and 1 attachment on "${DEMO_ATTACHMENT.challengeTitle}".`,
  );
  console.log(`  admin  / ${adminPassword}`);
  console.log(`  player / ${playerPassword}  (member of "Demo Team")`);
  console.log(`  ${DEMO_TEAMS.length} rival teams are already on the scoreboard.`);
} finally {
  await pool.end();
}
