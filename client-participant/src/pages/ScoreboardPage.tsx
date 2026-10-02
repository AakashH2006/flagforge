import { useParams } from 'react-router';
import { useAuth } from '../auth';
import { MAX_SERIES, RankGraph } from '../components/RankGraph';
import { ScoreboardTable } from '../components/ScoreboardTable';
import { Banner, CategoryTag, ErrorNote, EventHeader, LiveDot, PageLoader } from '../components/ui';
import { formatDateTime } from '../lib/game';
import { useApi, usePhase, useTick } from '../lib/hooks';
import { useLiveScoreboard, useThrottledReload } from '../lib/live';
import type { CtfEvent, Scoreboard, ScoreboardHistory, Team } from '../lib/types';
import { NotFoundPage } from './NotFoundPage';

/**
 * The public scoreboard. Anyone with the link can watch, signed in or not. The standings arrive
 * over the socket and the graph behind them is refetched (at most every few seconds) whenever
 * they change.
 */
export function ScoreboardPage() {
  const { eventId = '' } = useParams();
  const query = useApi<{ event: CtfEvent }>(`/api/events/${encodeURIComponent(eventId)}`);

  if (query.data) return <ScoreboardView key={query.data.event.id} event={query.data.event} />;
  if (query.error?.status === 404) {
    return <NotFoundPage title="Event not found" message="This event doesn't exist or was removed." />;
  }
  if (query.error) return <ErrorNote error={query.error} onRetry={query.reload} />;
  return <PageLoader label="Loading event…" />;
}

function ScoreboardView({ event }: { event: CtfEvent }) {
  const { user } = useAuth();
  const phase = usePhase(event);
  const started = phase !== 'upcoming';
  const eventBase = `/api/events/${event.id}`;

  const initial = useApi<Scoreboard>(started ? `${eventBase}/scoreboard` : null);
  const history = useApi<ScoreboardHistory>(started ? `${eventBase}/scoreboard/history?limit=${MAX_SERIES}` : null);
  const live = useLiveScoreboard(started ? event.id : null);
  // Only to highlight your own row; a signed-out spectator simply has no team.
  const team = useApi<{ team: Team }>(user?.role === 'player' && started ? `${eventBase}/teams/me` : null);

  const scoreboard = live.scoreboard ?? initial.data;
  useThrottledReload(scoreboard?.updatedAt, history.reload, 8000);
  // While the event runs the graph's right edge is "now", so the lines keep extending.
  useTick(phase === 'live' ? 30_000 : null);

  const header = <EventHeader event={event} phase={phase} tab="scoreboard" />;

  if (!started) {
    return (
      <>
        {header}
        <section className="panel empty">
          <h2>The scoreboard opens when the event starts</h2>
          <p className="muted">Nothing to see yet — no team has anything to score.</p>
        </section>
      </>
    );
  }

  if (initial.error && !scoreboard) return <ErrorNote error={initial.error} onRetry={initial.reload} />;
  if (!scoreboard) return <PageLoader label="Loading the scoreboard…" />;

  const yourTeamId = team.data?.team.id;
  const you = scoreboard.teams.find((entry) => entry.teamId === yourTeamId);

  return (
    <>
      {header}

      <div className="scoreboard-bar">
        <LiveDot connected={live.connected} updatedAt={scoreboard.updatedAt} />
        {you && (
          <span className="muted small-text">
            You're <strong className="mono">#{you.rank}</strong> of {scoreboard.totalTeams} with{' '}
            <strong className="mono">{you.score}</strong> points
          </span>
        )}
      </div>

      {history.data && (
        <RankGraph
          history={history.data}
          startsAt={event.startsAt}
          endsAt={phase === 'live' ? Date.now() : Date.parse(event.endsAt)}
          highlightTeamId={yourTeamId}
        />
      )}
      {history.error && !history.data && <ErrorNote error={history.error} onRetry={history.reload} />}

      <ScoreboardTable teams={scoreboard.teams} totalTeams={scoreboard.totalTeams} yourTeamId={yourTeamId} />

      <ChallengeValues scoreboard={scoreboard} />
    </>
  );
}

/** What each challenge is worth now, and who drew first blood. */
function ChallengeValues({ scoreboard }: { scoreboard: Scoreboard }) {
  if (scoreboard.challenges.length === 0) return null;

  return (
    <section className="panel" aria-labelledby="values-title">
      <div className="panel-head">
        <h2 id="values-title">Challenge values</h2>
        <p className="muted small-text">Dynamic scoring: the more teams solve a challenge, the less it is worth.</p>
      </div>
      <ul className="value-list">
        {scoreboard.challenges.map((challenge) => (
          <li key={challenge.id}>
            <span className="value-points mono">{challenge.points}</span>
            <span className="value-main">
              <span className="value-title">{challenge.title}</span>
              <span className="muted small-text">
                {challenge.solves === 0 ? 'Unsolved' : `${challenge.solves} solve${challenge.solves === 1 ? '' : 's'}`}
                {challenge.firstBlood && (
                  <>
                    {' · ⚡ '}
                    {challenge.firstBlood.name} at {formatDateTime(challenge.firstBlood.solvedAt)}
                  </>
                )}
              </span>
            </span>
            <CategoryTag category={challenge.category} />
          </li>
        ))}
      </ul>
      {scoreboard.challenges.every((challenge) => challenge.solves === 0) && (
        <Banner tone="muted">Every challenge is still at full value. First blood is up for grabs.</Banner>
      )}
    </section>
  );
}
