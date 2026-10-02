import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChallengeEditor } from '../components/ChallengeEditor';
import { ChallengeTable } from '../components/ChallengeTable';
import { EventForm } from '../components/EventForm';
import { ConfirmDialog, ErrorNote, EventTiming, PageLoader, PhaseBadge } from '../components/ui';
import { apiRequest, toApiError } from '../lib/api';
import { formatDateTime, phaseAt } from '../lib/format';
import { useApi } from '../lib/hooks';
import type { AdminChallenge, AdminEvent, EventPhase, Scoreboard } from '../lib/types';

const PARTICIPANT_URL = (import.meta.env.VITE_PARTICIPANT_URL ?? 'http://localhost:5174').replace(/\/+$/, '');

type Tab = 'challenges' | 'settings';

export function EventPage() {
  const { eventId } = useParams();
  const event = useApi<{ event: AdminEvent }>(`/api/admin/events/${eventId}`);
  const challenges = useApi<{ challenges: AdminChallenge[] }>(`/api/admin/events/${eventId}/challenges`);
  const [tab, setTab] = useState<Tab>('challenges');
  const [editing, setEditing] = useState<AdminChallenge | 'new' | null>(null);

  if (event.error) return <ErrorNote error={event.error} onRetry={event.reload} />;
  if (!event.data) return <PageLoader label="Loading event…" />;

  const current = event.data.event;
  const phase = phaseAt(current);

  return (
    <>
      <div className="event-head">
        <Link to="/" className="back-link">
          ← All events
        </Link>
        <div className="event-title-row">
          <h1>{current.name}</h1>
          <PhaseBadge phase={phase} />
        </div>
        <p className="muted">
          {formatDateTime(current.startsAt)} – {formatDateTime(current.endsAt)} ·{' '}
          <EventTiming event={current} phase={phase} />
        </p>
        <nav className="event-tabs" aria-label="Event sections">
          <button type="button" aria-current={tab === 'challenges' ? 'page' : undefined} onClick={() => setTab('challenges')}>
            Challenges
          </button>
          <button type="button" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setTab('settings')}>
            Settings
          </button>
          <a href={`${PARTICIPANT_URL}/events/${current.id}/scoreboard`} target="_blank" rel="noopener noreferrer">
            Live scoreboard ↗
          </a>
        </nav>
      </div>

      {tab === 'challenges' ? (
        <ChallengesTab
          event={current}
          phase={phase}
          query={challenges}
          onEdit={setEditing}
        />
      ) : (
        <SettingsTab event={current} onSaved={event.reload} />
      )}

      {editing && (
        <ChallengeEditor
          eventId={current.id}
          challenge={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            challenges.reload();
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ChallengesTab({
  event,
  phase,
  query,
  onEdit,
}: {
  event: AdminEvent;
  phase: EventPhase;
  query: ReturnType<typeof useApi<{ challenges: AdminChallenge[] }>>;
  onEdit: (challenge: AdminChallenge | 'new') => void;
}) {
  // The scoreboard carries live solve counts, and only exists once the event has started.
  const scoreboard = useApi<Scoreboard>(phase === 'upcoming' ? null : `/api/events/${event.id}/scoreboard`);
  const solvesById = new Map(scoreboard.data?.challenges.map((entry) => [entry.id, entry]) ?? []);

  if (query.error) return <ErrorNote error={query.error} onRetry={query.reload} />;
  if (!query.data) return <PageLoader label="Loading challenges…" />;

  const all = query.data.challenges;
  const published = all.filter((challenge) => !challenge.isHidden).length;

  return (
    <>
      <div className="row-between section-head">
        <p className="muted small-text">
          {all.length === 0
            ? 'No challenges yet.'
            : `${all.length} challenge${all.length === 1 ? '' : 's'}, ${published} published${
                published < all.length ? `, ${all.length - published} still drafts` : ''
              }.`}
        </p>
        <button type="button" className="button" onClick={() => onEdit('new')}>
          New challenge
        </button>
      </div>

      {all.length === 0 ? (
        <section className="panel empty">
          <h2>Write your first challenge</h2>
          <p className="muted">
            New challenges start as drafts. Players only see them once you publish, so you can write the whole set
            before the event opens.
          </p>
        </section>
      ) : (
        <ChallengeTable
          eventId={event.id}
          challenges={all}
          solves={solvesById}
          onEdit={onEdit}
          onChanged={query.reload}
        />
      )}
    </>
  );
}

function SettingsTab({ event, onSaved }: { event: AdminEvent; onSaved: () => void }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiRequest(`/api/admin/events/${event.id}`, { method: 'DELETE' });
      void navigate('/');
    } catch (err) {
      setDeleteError(toApiError(err).message);
      setDeleting(false);
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2>Event details</h2>
        <p className="muted small-text">
          Moving the window re-ranks level teams: ties are broken on who got there first, measured from the start
          time.
        </p>
        <EventForm
          // A fresh form whenever the saved event changes, so the inputs follow the server.
          key={event.updatedAt}
          event={event}
          submitLabel="Save changes"
          onSaved={() => {
            setSaved(true);
            onSaved();
          }}
        />
        {saved && (
          <p className="hint" role="status">
            Saved.
          </p>
        )}
      </section>

      <section className="panel danger-zone">
        <h2>Delete this event</h2>
        <p className="muted small-text">
          This removes its challenges, teams, solves and uploaded files. It cannot be undone.
        </p>
        <button type="button" className="button danger" onClick={() => setConfirming(true)}>
          Delete event
        </button>
      </section>

      {confirming && (
        <ConfirmDialog
          title="Delete event"
          confirmLabel="Delete it"
          pending={deleting}
          error={deleteError}
          onConfirm={() => void remove()}
          onClose={() => setConfirming(false)}
        >
          <strong>{event.name}</strong> and everything in it will be gone for good.
        </ConfirmDialog>
      )}
    </div>
  );
}
