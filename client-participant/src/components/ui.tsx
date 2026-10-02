import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { ApiError } from '../lib/api';
import { CATEGORY_LABELS, formatAgo, formatDateTime, formatDuration } from '../lib/game';
import { useTick } from '../lib/hooks';
import type { Category, CtfEvent, EventPhase } from '../lib/types';

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loader" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="banner banner-danger" role="alert">
      <div>{error.message}</div>
      {onRetry && (
        <button type="button" className="button ghost small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Banner({
  tone,
  title,
  children,
  className = '',
}: {
  tone: 'success' | 'danger' | 'warning' | 'info' | 'muted';
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`banner banner-${tone} ${className}`}>
      <div>
        {title && <strong className="banner-title">{title}</strong>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

const PHASE_LABELS: Record<EventPhase, string> = { upcoming: 'Upcoming', live: 'Live', ended: 'Ended' };

export function PhaseBadge({ phase }: { phase: EventPhase }) {
  return <span className={`badge badge-${phase}`}>{PHASE_LABELS[phase]}</span>;
}

/** "Starts in …", "Ends in …" or "Ended …", kept current every second. */
export function EventTiming({ event, phase }: { event: CtfEvent; phase: EventPhase }) {
  useTick(phase === 'ended' ? null : 1000);
  const now = Date.now();

  if (phase === 'upcoming') {
    return (
      <>
        Starts in <strong className="mono">{formatDuration(Date.parse(event.startsAt) - now)}</strong>
      </>
    );
  }
  if (phase === 'live') {
    return (
      <>
        Ends in <strong className="mono">{formatDuration(Date.parse(event.endsAt) - now)}</strong>
      </>
    );
  }
  return <>Ended {formatDateTime(event.endsAt)}</>;
}

/** Title, timing and the challenges/scoreboard tabs. Shared by both views of an event. */
export function EventHeader({
  event,
  phase,
  tab,
}: {
  event: CtfEvent;
  phase: EventPhase;
  tab: 'challenges' | 'scoreboard';
}) {
  return (
    <div className="event-head">
      <Link to="/" className="back-link">
        ← All events
      </Link>
      <div className="event-title-row">
        <h1>{event.name}</h1>
        <PhaseBadge phase={phase} />
      </div>
      <p className="muted">
        <EventTiming event={event} phase={phase} />
      </p>
      {phase !== 'upcoming' && (
        <nav className="event-tabs" aria-label="Event sections">
          <Link to={`/events/${event.id}`} aria-current={tab === 'challenges' ? 'page' : undefined}>
            Challenges
          </Link>
          <Link to={`/events/${event.id}/scoreboard`} aria-current={tab === 'scoreboard' ? 'page' : undefined}>
            Scoreboard
          </Link>
        </nav>
      )}
    </div>
  );
}

/** Shows whether the page is receiving live pushes, and how fresh the numbers are. */
export function LiveDot({ connected, updatedAt }: { connected: boolean; updatedAt?: string }) {
  useTick(connected ? null : 5000);
  return (
    <span className="live-dot" data-connected={connected}>
      <span className="live-dot-mark" aria-hidden="true" />
      {connected ? 'Live' : updatedAt ? `Updated ${formatAgo(updatedAt)}` : 'Connecting…'}
    </span>
  );
}

export function CategoryTag({ category }: { category: Category }) {
  return (
    <span className="cat-tag" data-category={category}>
      {CATEGORY_LABELS[category]}
    </span>
  );
}
