import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useAuth } from '../auth';
import { ChallengeBoard } from '../components/ChallengeBoard';
import { ChallengeDialog } from '../components/ChallengeDialog';
import { TeamPanel } from '../components/TeamPanel';
import { Banner, ErrorNote, EventHeader, EventTiming, PageLoader } from '../components/ui';
import { useApi, usePhase } from '../lib/hooks';
import { useLiveScoreboard } from '../lib/live';
import type { Challenge, CtfEvent, Team } from '../lib/types';
import { NotFoundPage } from './NotFoundPage';

export function EventPage() {
  const { eventId = '' } = useParams();
  const query = useApi<{ event: CtfEvent }>(`/api/events/${encodeURIComponent(eventId)}`);

  if (query.data) return <EventView key={query.data.event.id} event={query.data.event} />;
  if (query.error?.status === 404) {
    return <NotFoundPage title="Event not found" message="This event doesn't exist or was removed." />;
  }
  if (query.error) return <ErrorNote error={query.error} onRetry={query.reload} />;
  return <PageLoader label="Loading event…" />;
}

function EventView({ event }: { event: CtfEvent }) {
  const { user } = useAuth();
  const isPlayer = user?.role === 'player';
  const phase = usePhase(event);
  const eventBase = `/api/events/${event.id}`;

  const teamQuery = useApi<{ team: Team }>(isPlayer ? `${eventBase}/teams/me` : null);
  const challengesQuery = useApi<{ challenges: Challenge[] }>(
    isPlayer && phase !== 'upcoming' ? `${eventBase}/challenges` : null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rateLimitedUntil, setRateLimitedUntil] = useState(0);

  const { reload: reloadTeam } = teamQuery;
  const { reload: reloadChallenges } = challengesQuery;

  // Challenge values move as other teams solve. The live scoreboard already carries the current
  // value and solve count for every challenge, so the board stays current without refetching.
  const live = useLiveScoreboard(isPlayer && phase !== 'upcoming' ? event.id : null);
  const challenges = useMemo(() => {
    const fetched = challengesQuery.data?.challenges;
    if (!fetched || !live.scoreboard) return fetched;
    const values = new Map(live.scoreboard.challenges.map((entry) => [entry.id, entry]));
    return fetched.map((challenge) => {
      const current = values.get(challenge.id);
      return current ? { ...challenge, points: current.points, solves: current.solves } : challenge;
    });
  }, [challengesQuery.data, live.scoreboard]);

  // Pick up teammates' solves and new members when the player comes back to the tab. Solves are
  // per team, so they don't come over the public scoreboard feed.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      reloadTeam();
      reloadChallenges();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reloadTeam, reloadChallenges]);

  const header = <EventHeader event={event} phase={phase} tab="challenges" />;

  if (!isPlayer) {
    return (
      <>
        {header}
        <Banner tone="info" title="You're signed in as an organizer">
          Organizer accounts manage events and can't join teams or submit flags. Sign in with a player account
          to play.
        </Banner>
      </>
    );
  }

  const hasTeam = teamQuery.data !== undefined;
  let blockedReason: string | null = null;
  if (phase === 'ended') blockedReason = 'This event has ended, so flag submissions are closed.';
  else if (!hasTeam && !teamQuery.error) blockedReason = 'Loading your team…';
  else if (!hasTeam) blockedReason = 'Join or create a team to submit flags.';

  const selected = challenges?.find((challenge) => challenge.id === selectedId);

  let main;
  if (phase === 'upcoming') {
    main = (
      <section className="panel empty">
        <h2>Challenges unlock when the event starts</h2>
        <p className="countdown">
          <EventTiming event={event} phase={phase} />
        </p>
        <p className="muted">Use the time to get your team together.</p>
      </section>
    );
  } else if (challenges) {
    main = <ChallengeBoard challenges={challenges} onOpen={setSelectedId} />;
  } else if (challengesQuery.error) {
    main = <ErrorNote error={challengesQuery.error} onRetry={reloadChallenges} />;
  } else {
    main = <PageLoader label="Loading challenges…" />;
  }

  return (
    <>
      {header}
      <div className="event-layout">
        <div className="event-main">{main}</div>
        <aside className="event-aside">
          <TeamPanel
            eventBase={eventBase}
            phase={phase}
            query={teamQuery}
            onJoined={() => {
              reloadTeam();
              reloadChallenges();
            }}
          />
        </aside>
      </div>

      {selected && (
        <ChallengeDialog
          key={selected.id}
          challenge={selected}
          eventBase={eventBase}
          blockedReason={blockedReason}
          rateLimitedUntil={rateLimitedUntil}
          onRateLimited={setRateLimitedUntil}
          onSolved={reloadChallenges}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}
