import { randomBytes } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { RequestHandler, Response } from 'express';
import multer, { MulterError } from 'multer';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { attachments } from '../db/schema.js';
import { HttpError, notFound, parseId } from '../lib/errors.js';

/**
 * Challenge attachments: the pcap, binary or zip a challenge hands out.
 *
 * Metadata lives in Postgres; the bytes live on disk under `UPLOAD_DIR`, named by a random
 * `storageKey`. The organizer's filename is only ever data — it is stored for the download
 * header and never used as a path, so it can't escape the upload directory or collide.
 */

export const uploadRoot = path.resolve(env.UPLOAD_DIR);

const storagePath = (storageKey: string) => path.join(uploadRoot, storageKey);

export const ensureUploadDir = () => mkdir(uploadRoot, { recursive: true });

/** What clients see. The storage key stays on the server. */
export const attachmentColumns = {
  id: attachments.id,
  filename: attachments.filename,
  sizeBytes: attachments.sizeBytes,
  createdAt: attachments.createdAt,
};

export type Attachment = { id: string; filename: string; sizeBytes: number; createdAt: Date };

/** Every challenge's attachments for one event, keyed by challenge id. */
export async function attachmentsByChallenge(eventId: string) {
  const rows = await db
    .select({ challengeId: attachments.challengeId, ...attachmentColumns })
    .from(attachments)
    .where(eq(attachments.eventId, eventId))
    .orderBy(asc(attachments.filename));

  const byChallenge = new Map<string, Attachment[]>();
  for (const { challengeId, ...attachment } of rows) {
    const list = byChallenge.get(challengeId);
    if (list) list.push(attachment);
    else byChallenge.set(challengeId, [attachment]);
  }
  return byChallenge;
}

/** One challenge's attachments. */
export async function listAttachments(challengeId: string): Promise<Attachment[]> {
  return db
    .select(attachmentColumns)
    .from(attachments)
    .where(eq(attachments.challengeId, challengeId))
    .orderBy(asc(attachments.filename));
}

/**
 * Deletes the files behind the given rows. Called after the rows are gone, so a failure here
 * leaves an unreferenced file rather than an attachment players can't download.
 */
export async function removeStoredFiles(storageKeys: string[]) {
  await Promise.all(
    storageKeys.map((key) =>
      unlink(storagePath(key)).catch((err: unknown) => {
        console.error(`Failed to delete upload ${key}:`, err);
      }),
    ),
  );
}

/** The storage keys behind a challenge or a whole event, read before deleting the rows. */
export async function storageKeysForChallenge(challengeId: string) {
  const rows = await db
    .select({ storageKey: attachments.storageKey })
    .from(attachments)
    .where(eq(attachments.challengeId, challengeId));
  return rows.map((row) => row.storageKey);
}

export async function storageKeysForEvent(eventId: string) {
  const rows = await db
    .select({ storageKey: attachments.storageKey })
    .from(attachments)
    .where(eq(attachments.eventId, eventId));
  return rows.map((row) => row.storageKey);
}

export async function countAttachments(challengeId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(attachments)
    .where(eq(attachments.challengeId, challengeId));
  return row!.count;
}

/** Streams one attachment to the client, as a download rather than something to render. */
export async function sendAttachment(res: Response, challengeId: string, rawAttachmentId: unknown) {
  const attachmentId = parseId(rawAttachmentId, 'Attachment');
  const [attachment] = await db
    .select({ filename: attachments.filename, storageKey: attachments.storageKey })
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.challengeId, challengeId)));
  if (!attachment) throw notFound('Attachment');

  await new Promise<void>((resolve, reject) => {
    res.download(
      attachment.storageKey,
      attachment.filename,
      {
        // Serving from `root` keeps the read inside the upload directory whatever the key says.
        root: uploadRoot,
        // Attachments always download as bytes. The API origin is where session tokens live, so
        // a file an organizer uploaded must never be something the browser renders there.
        headers: { 'Content-Type': 'application/octet-stream' },
      },
      (err) => {
        if (!err) {
          resolve();
          return;
        }
        console.error(`Failed to send attachment ${attachmentId}:`, err);
        // Past the headers it is a client that hung up, and there is nothing left to say.
        if (res.headersSent) {
          res.destroy();
          resolve();
        } else {
          reject(new HttpError(404, 'This attachment is no longer available'));
        }
      },
    );
  });
}

const storage = multer.diskStorage({
  destination: (_req, _file, done) => {
    // The directory is made at startup; doing it again covers it being removed while running.
    ensureUploadDir().then(
      () => done(null, uploadRoot),
      (err: Error) => done(err, uploadRoot),
    );
  },
  filename: (_req, _file, done) => done(null, randomBytes(16).toString('hex')),
});

const single = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 1 },
  // Browsers send UTF-8 filenames; multer would otherwise read them as latin1.
  defParamCharset: 'utf8',
}).single('file');

const MAX_MB = Math.round(env.MAX_UPLOAD_BYTES / (1024 * 1024));

function uploadError(err: MulterError) {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return new HttpError(413, `Attachments must be ${MAX_MB} MB or smaller`);
    case 'LIMIT_UNEXPECTED_FILE':
      return new HttpError(400, 'Send the file as a single `file` field');
    default:
      return new HttpError(400, 'Could not read the uploaded file');
  }
}

/** Reads one `file` field out of a multipart body onto `req.file`. */
export const receiveUpload: RequestHandler = (req, res, next) => {
  single(req, res, (err: unknown) => {
    next(err instanceof MulterError ? uploadError(err) : err);
  });
};

/**
 * The name to store for a file the organizer picked. Path separators and control characters are
 * dropped, so the result is safe in a Content-Disposition header and meaningless as a path.
 */
export function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim();
  return cleaned.slice(0, 200) || 'attachment';
}
