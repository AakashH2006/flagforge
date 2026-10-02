import { useLayoutEffect, useRef } from 'react';
import { usePrefersReducedMotion, useRecentlyChanged } from '../lib/live';
import { formatAgo } from '../lib/game';
import type { ScoreboardTeam } from '../lib/types';
import { SERIES_COLORS, MAX_SERIES } from './RankGraph';

/**
 * The standings. Rows slide to their new position when the ranking changes, so a team passing
 * another is something you can see happen rather than something you notice later.
 */

type Props = { teams: ScoreboardTeam[]; totalTeams: number; yourTeamId?: string };

/** Animates rows from where they were to where they now are (a FLIP). */
function useRankAnimation(teams: ScoreboardTeam[]) {
  const rows = useRef(new Map<string, HTMLTableRowElement>());
  const positions = useRef(new Map<string, number>());
  const reducedMotion = usePrefersReducedMotion();

  useLayoutEffect(() => {
    const previous = positions.current;
    const next = new Map<string, number>();

    rows.current.forEach((row, teamId) => {
      const top = row.offsetTop;
      next.set(teamId, top);
      const before = previous.get(teamId);
      if (reducedMotion || before === undefined || before === top) return;
      row.animate(
        [{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }],
        { duration: 420, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
      );
    });

    positions.current = next;
  }, [teams, reducedMotion]);

  return (teamId: string) => (row: HTMLTableRowElement | null) => {
    if (row) rows.current.set(teamId, row);
    else rows.current.delete(teamId);
  };
}

export function ScoreboardTable({ teams, totalTeams, yourTeamId }: Props) {
  const rowRef = useRankAnimation(teams);

  if (teams.length === 0) {
    return (
      <section className="panel empty">
        <h2>No teams yet</h2>
        <p className="muted">The scoreboard fills up as teams register and start solving.</p>
      </section>
    );
  }

  return (
    <section className="panel scoreboard" aria-labelledby="standings-title">
      <div className="panel-head">
        <h2 id="standings-title">Standings</h2>
        <p className="muted small-text">
          {teams.length === totalTeams ? `${totalTeams} teams` : `Top ${teams.length} of ${totalTeams} teams`}
        </p>
      </div>

      <table className="score-table">
        <thead>
          <tr>
            <th scope="col" className="col-rank">
              #
            </th>
            <th scope="col">Team</th>
            <th scope="col" className="col-num">
              Solves
            </th>
            <th scope="col" className="col-num">
              Points
            </th>
            <th scope="col" className="col-last">
              Last solve
            </th>
          </tr>
        </thead>
        <tbody>
          {teams.map((team, index) => (
            <ScoreRow
              key={team.teamId}
              ref={rowRef(team.teamId)}
              team={team}
              color={index < MAX_SERIES ? SERIES_COLORS[index] : undefined}
              isYou={team.teamId === yourTeamId}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ScoreRow({
  team,
  color,
  isYou,
  ref,
}: {
  team: ScoreboardTeam;
  color?: string;
  isYou: boolean;
  ref: (row: HTMLTableRowElement | null) => void;
}) {
  const bumped = useRecentlyChanged(team.score);

  return (
    <tr ref={ref} data-you={isYou} data-bumped={bumped}>
      <td className="col-rank mono">{team.rank}</td>
      <th scope="row" className="col-team">
        {/* The colour ties the row to its line in the graph above; the name carries the identity. */}
        <span className="graph-key" style={{ background: color ?? 'var(--border-strong)' }} aria-hidden="true" />
        {team.name}
        {isYou && <span className="role-tag">you</span>}
        {team.firstBloods > 0 && (
          <span className="blood-tag" title={`First to solve ${team.firstBloods} challenge(s)`}>
            ⚡ {team.firstBloods}
          </span>
        )}
      </th>
      <td className="col-num mono">{team.solves}</td>
      <td className="col-num mono score-cell">{team.score}</td>
      <td className="col-last muted small-text">{team.lastSolveAt ? formatAgo(team.lastSolveAt) : '—'}</td>
    </tr>
  );
}
