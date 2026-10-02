import type { Category, CtfEvent, EventPhase } from './types';

export const CATEGORY_LABELS: Record<Category, string> = {
  web: 'Web',
  crypto: 'Crypto',
  pwn: 'Pwn',
  forensics: 'Forensics',
  reverse: 'Reverse',
  misc: 'Misc',
};

export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as Category[];

/** Same rule as the server: live from startsAt (inclusive) until endsAt (exclusive). */
export function phaseAt(event: Pick<CtfEvent, 'startsAt' | 'endsAt'>, now = Date.now()): EventPhase {
  if (now < Date.parse(event.startsAt)) return 'upcoming';
  if (now >= Date.parse(event.endsAt)) return 'ended';
  return 'live';
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  return `${seconds}s`;
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** Just the time of day, for graph axes and tooltips. */
export const formatClock = (time: number | string) => clockFormat.format(new Date(time));

/** "2m ago", for a timestamp that is usually recent. */
export function formatAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return formatDateTime(iso);
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
