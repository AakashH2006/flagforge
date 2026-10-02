import { readdir, rm } from 'node:fs/promises';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config.js';
import { ensureUploadDir, safeFilename, uploadRoot } from '../src/services/attachments.js';
import {
  api,
  closeConnections,
  createChallenge,
  createEvent,
  createUser,
  hoursFromNow,
  resetState,
} from './helpers.js';

// The upload directory outlives a database reset, so it is cleared alongside it.
beforeEach(async () => {
  await resetState();
  await rm(uploadRoot, { recursive: true, force: true });
});
afterAll(closeConnections);

type Session = Awaited<ReturnType<typeof createUser>>;

const BYTES = Buffer.from('PK\u0003\u0004 pretend this is a zip');

const attachmentsPath = (eventId: string, challengeId: string) =>
  `/api/admin/events/${eventId}/challenges/${challengeId}/attachments`;

const upload = (eventId: string, challengeId: string, admin: Session, filename: string, body: Buffer = BYTES) =>
  api()
    .post(attachmentsPath(eventId, challengeId))
    .set('Authorization', admin.token)
    .attach('file', body, filename);

/** What is actually on disk, so the tests can tell whether rejected bytes were cleaned up. */
async function storedFiles() {
  await ensureUploadDir();
  return readdir(uploadRoot);
}

async function organizerWithChallenge(window?: { startsAt: Date; endsAt: Date }) {
  const admin = await createUser('admin');
  const event = await createEvent(admin.id, window);
  const challenge = await createChallenge(event.id);
  return { admin, event, challenge };
}

describe('uploading attachments', () => {
  it('stores a file, lists it and hands it back on download', async () => {
    const { admin, event, challenge } = await organizerWithChallenge();

    const created = await upload(event.id, challenge.id, admin, 'handout.zip').expect(201);
    expect(created.body.attachment).toMatchObject({ filename: 'handout.zip', sizeBytes: BYTES.length });
    // The storage key is the server's business and never leaves it.
    expect(created.body.attachment).not.toHaveProperty('storageKey');

    const list = await api()
      .get(`/api/admin/events/${event.id}/challenges`)
      .set('Authorization', admin.token)
      .expect(200);
    expect(list.body.challenges[0].attachments).toHaveLength(1);

    const download = await api()
      .get(`${attachmentsPath(event.id, challenge.id)}/${created.body.attachment.id}`)
      .set('Authorization', admin.token)
      .expect(200);
    expect(download.headers['content-disposition']).toContain('attachment; filename="handout.zip"');
    expect(download.headers['content-type']).toBe('application/octet-stream');
    expect(Buffer.from(download.body)).toEqual(BYTES);
  });

  it('names files on disk itself, so an organizer cannot choose the path', async () => {
    const { admin, event, challenge } = await organizerWithChallenge();

    const created = await upload(event.id, challenge.id, admin, '../../escape.sh').expect(201);
    expect(created.body.attachment.filename).toBe('escape.sh');

    const files = await storedFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{32}$/);
  });

  it('rejects a file over the size limit without keeping it', async () => {
    const { admin, event, challenge } = await organizerWithChallenge();
    const tooBig = Buffer.alloc(env.MAX_UPLOAD_BYTES + 1, 0x41);

    await upload(event.id, challenge.id, admin, 'big.bin', tooBig).expect(413);
    expect(await storedFiles()).toEqual([]);
  });

  it('rejects a duplicate filename and a challenge that is already full', async () => {
    const { admin, event, challenge } = await organizerWithChallenge();

    await upload(event.id, challenge.id, admin, 'dup.txt').expect(201);
    await upload(event.id, challenge.id, admin, 'DUP.TXT').expect(409);
    // Still one file: the rejected upload took its bytes with it.
    expect(await storedFiles()).toHaveLength(1);

    for (let i = 1; i < env.MAX_ATTACHMENTS_PER_CHALLENGE; i++) {
      await upload(event.id, challenge.id, admin, `extra${i}.txt`).expect(201);
    }
    await upload(event.id, challenge.id, admin, 'one-too-many.txt').expect(409);
    expect(await storedFiles()).toHaveLength(env.MAX_ATTACHMENTS_PER_CHALLENGE);
  });

  it('will not upload to an event the organizer does not own', async () => {
    const { event, challenge } = await organizerWithChallenge();
    const other = await createUser('admin');
    const player = await createUser('player');

    await upload(event.id, challenge.id, other, 'theirs.zip').expect(404);
    await upload(event.id, challenge.id, player, 'theirs.zip').expect(403);
    expect(await storedFiles()).toEqual([]);
  });
});

describe('deleting attachments', () => {
  it('removes the row and the file', async () => {
    const { admin, event, challenge } = await organizerWithChallenge();
    const created = await upload(event.id, challenge.id, admin, 'gone.zip').expect(201);
    const path = `${attachmentsPath(event.id, challenge.id)}/${created.body.attachment.id}`;

    await api().delete(path).set('Authorization', admin.token).expect(204);
    await api().delete(path).set('Authorization', admin.token).expect(404);
    await api().get(path).set('Authorization', admin.token).expect(404);
    expect(await storedFiles()).toEqual([]);
  });

  it('takes the files with the challenge and with the event', async () => {
    const { admin, event, challenge } = await organizerWithChallenge();
    await upload(event.id, challenge.id, admin, 'challenge-file.zip').expect(201);

    await api()
      .delete(`/api/admin/events/${event.id}/challenges/${challenge.id}`)
      .set('Authorization', admin.token)
      .expect(204);
    expect(await storedFiles()).toEqual([]);

    const second = await createChallenge(event.id, { title: 'Second' });
    await upload(event.id, second.id, admin, 'event-file.zip').expect(201);
    await api().delete(`/api/admin/events/${event.id}`).set('Authorization', admin.token).expect(204);
    expect(await storedFiles()).toEqual([]);
  });
});

describe('players downloading attachments', () => {
  it('gives a published challenge file to any signed-in player', async () => {
    const { admin, event, challenge } = await organizerWithChallenge();
    const created = await upload(event.id, challenge.id, admin, 'evidence.pcap').expect(201);
    const player = await createUser('player');

    const list = await api().get(`/api/events/${event.id}/challenges`).set('Authorization', player.token).expect(200);
    expect(list.body.challenges[0].attachments).toEqual([
      {
        id: created.body.attachment.id,
        filename: 'evidence.pcap',
        sizeBytes: BYTES.length,
        createdAt: expect.any(String),
      },
    ]);

    const download = await api()
      .get(`/api/events/${event.id}/challenges/${challenge.id}/attachments/${created.body.attachment.id}`)
      .set('Authorization', player.token)
      .expect(200);
    expect(Buffer.from(download.body)).toEqual(BYTES);
  });

  it('keeps hidden challenges, unstarted events and anonymous visitors out', async () => {
    const admin = await createUser('admin');
    const event = await createEvent(admin.id);
    const hidden = await createChallenge(event.id, { title: 'Draft', isHidden: true });
    const draft = await upload(event.id, hidden.id, admin, 'draft.zip').expect(201);
    const player = await createUser('player');
    const path = `/api/events/${event.id}/challenges/${hidden.id}/attachments/${draft.body.attachment.id}`;

    await api().get(path).expect(401);
    await api().get(path).set('Authorization', player.token).expect(404);

    // Published, but its event hasn't started yet.
    const upcoming = await createEvent(admin.id, { startsAt: hoursFromNow(1), endsAt: hoursFromNow(2) });
    const locked = await createChallenge(upcoming.id, { title: 'Locked' });
    const early = await upload(upcoming.id, locked.id, admin, 'early.zip').expect(201);
    await api()
      .get(`/api/events/${upcoming.id}/challenges/${locked.id}/attachments/${early.body.attachment.id}`)
      .set('Authorization', player.token)
      .expect(403);
  });
});

describe('safeFilename', () => {
  it('reduces a filename to something harmless', () => {
    expect(safeFilename('notes.txt')).toBe('notes.txt');
    expect(safeFilename('C:\\Users\\me\\loot.zip')).toBe('loot.zip');
    expect(safeFilename('../../../etc/passwd')).toBe('passwd');
    expect(safeFilename('..')).toBe('attachment');
    expect(safeFilename('   ')).toBe('attachment');
    expect(safeFilename('head\ner.txt')).toBe('header.txt');
    expect(safeFilename('a'.repeat(300))).toHaveLength(200);
  });
});
