import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config.js';

/**
 * Flags are stored as HMAC-SHA256(FLAG_SECRET, flag). A plain hash of a leaked row could be
 * cracked offline by guessing, but without the server-side secret the hashes are useless.
 * Flags are case-sensitive. Only surrounding whitespace is ignored.
 */
export function hashFlag(flag: string, secret = env.FLAG_SECRET): string {
  return createHmac('sha256', secret).update(flag.trim(), 'utf8').digest('hex');
}

export function verifyFlag(submitted: string, storedHash: string, secret = env.FLAG_SECRET): boolean {
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashFlag(submitted, secret), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
