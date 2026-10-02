import { Link } from 'react-router';
import { ErrorNote, EventTiming, PageLoader, PhaseBadge } from '../components/ui';
import { formatDateTime, phaseAt } from '../lib/game';
import { useApi, useTick } from '../lib/hooks';
import type { CtfEvent, EventPhase } from '../lib/types';

const PHASE_RANK: Record<EventPhase, number> = { live: 0, upcoming: 1, ended: 2 };

export function EventsPage() {
  const query = useApi<{ events: CtfEvent[] }>('/api/events');
  // Re-sort now and then, as events start and end while the page is open.
  useTick(30_000);

  let content;
  if (query.data) {
    const now = Date.now();
    const events = query.data.events
      .map((event) => ({ event, phase: phaseAt(event, now) }))
      .sort(
        (a, b) =>
          PHASE_RANK[a.phase] - PHASE_RANK[b.phase] ||
          (a.phase === 'ended'
            ? Date.parse(b.event.endsAt) - Date.parse(a.event.endsAt)
            : Date.parse(a.event.startsAt) - Date.parse(b.event.startsAt)),
      );

    content =
      events.length === 0 ? (
        <section className="panel empty">
          <h2>No events yet</h2>
          <p className="muted">When an organizer schedules an event, it shows up here.</p>
        </section>
      ) : (
        <ul className="event-list">
          {events.map(({ event, phase }) => (
            <li key={event.id}>
              <Link to={`/events/${event.id}`} className="event-card" data-phase={phase}>
                <div className="event-card-main">
                  <h2>{event.name}</h2>
                  <p className="muted small-text">
                    {formatDateTime(event.startsAt)} – {formatDateTime(event.endsAt)}
                  </p>
                </div>
                <div className="event-card-side">
                  <PhaseBadge phase={phase} />
                  <span className="muted small-text">
                    <EventTiming event={event} phase={phase} />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      );
  } else if (query.error) {
    content = <ErrorNote error={query.error} onRetry={query.reload} />;
  } else {
    content = <PageLoader label="Loading events…" />;
  }

  return (
    <>
      <div className="page-head">
        <h1>Events</h1>
        <p className="muted">Pick an event to see its challenges and start hacking.</p>
      </div>
      {content}
    </>
  );
}
