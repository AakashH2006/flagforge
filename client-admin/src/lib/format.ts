import type { Category, EventPhase } from './types';

export const CATEGORY_LABELS: Record<Category, string> = {
  web: 'Web',
  crypto: 'Crypto',
  pwn: 'Pwn',
  forensics: 'Forensics',
  reverse: 'Reverse',
  misc: 'Misc',
};

export const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];

/** Same rule as the server: live from startsAt (inclusive) until endsAt (exclusive). */
export function phaseAt(event: { startsAt: string; endsAt: string }, now = Date.now()): EventPhase {
  if (now < Date.parse(event.startsAt)) return 'upcoming';
  if (now >= Date.parse(event.endsAt)) return 'ended';
  return 'live';
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** "4.2 kB", for attachment sizes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * `<input type="datetime-local">` speaks local wall-clock time with no zone, while the API speaks
 * ISO instants. These two convert between them without going through UTC by mistake.
 */
export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export const fromLocalInput = (value: string) => new Date(value).toISOString();

/**
 * The server's dynamic scoring curve, mirrored so the editor can show what a challenge will be
 * worth before it is saved. Kept identical to server/src/lib/scoring.ts.
 */
export function challengePoints(
  rules: { initialPoints: number; minPoints: number; decay: number },
  solves: number,
): number {
  const { initialPoints, minPoints, decay } = rules;
  if (minPoints >= initialPoints) return initialPoints;
  const devaluing = Math.max(0, solves - 1);
  const fraction = Math.min(1, devaluing / Math.max(1, decay)) ** 2;
  return Math.round(initialPoints + (minPoints - initialPoints) * fraction);
}
