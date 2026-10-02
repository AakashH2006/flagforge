import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { EventForm } from '../components/EventForm';
import { ErrorNote, EventTiming, Modal, PageLoader, PhaseBadge } from '../components/ui';
import { formatDateTime, phaseAt } from '../lib/format';
import { useApi, useTick } from '../lib/hooks';
import type { AdminEvent, EventPhase } from '../lib/types';

const PHASE_RANK: Record<EventPhase, number> = { live: 0, upcoming: 1, ended: 2 };

export function EventsPage() {
  const query = useApi<{ events: AdminEvent[] }>('/api/admin/events');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  // Events start and end while the page is open, so the badges re-sort now and then.
  useTick(30_000);

  let content;
  if (query.data) {
    const now = Date.now();
    const events = query.data.events
      .map((event) => ({ event, phase: phaseAt(event, now) }))
      .sort(
        (a, b) =>
          PHASE_RANK[a.phase] - PHASE_RANK[b.phase] || Date.parse(b.event.startsAt) - Date.parse(a.event.startsAt),
      );

    content =
      events.length === 0 ? (
        <section className="panel empty">
          <h2>No events yet</h2>
          <p className="muted">Create one, write a few challenges, and publish them when you are ready.</p>
          <button type="button" className="button" onClick={() => setCreating(true)}>
            New event
          </button>
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
    content = <PageLoader label="Loading your events…" />;
  }

  return (
    <>
      <div className="page-head row-between">
        <div>
          <h1>Your events</h1>
          <p className="muted">Everything you have scheduled, newest first.</p>
        </div>
        <button type="button" className="button" onClick={() => setCreating(true)}>
          New event
        </button>
      </div>
      {content}

      {creating && (
        <Modal title="New event" onClose={() => setCreating(false)}>
          <EventForm
            submitLabel="Create event"
            onSaved={(event) => {
              // Straight into the new event, which is where the challenges get written.
              void navigate(`/events/${event.id}`);
            }}
            onCancel={() => setCreating(false)}
          />
        </Modal>
      )}
    </>
  );
}
