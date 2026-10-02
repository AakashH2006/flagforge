/**
 * Dynamic scoring. A challenge everyone solves is not much of a challenge, so its value falls as
 * the solve count rises:
 *
 *     value(n) = initialPoints + (minPoints - initialPoints) * (n / decay)^2     clamped to minPoints
 *
 * where `n` is the number of solves *after the first* (`solves - 1`). The first team to solve a
 * challenge therefore never devalues it, and the curve is flat at the start: the next few solvers
 * lose very little, while a challenge the whole field clears drops to `minPoints`. Set
 * `minPoints === initialPoints` for a fixed-value challenge.
 *
 * Every team holding a solve is worth the same current value, so a late solve can pull a team's
 * existing points down. That is deliberate: the scoreboard always reflects how hard each
 * challenge turned out to be, not how early you got there.
 */

export type ScoringRules = { initialPoints: number; minPoints: number; decay: number };

export function challengePoints(rules: ScoringRules, solves: number): number {
  const { initialPoints, minPoints, decay } = rules;
  if (minPoints >= initialPoints) return initialPoints;

  const devaluing = Math.max(0, solves - 1);
  const fraction = Math.min(1, devaluing / Math.max(1, decay)) ** 2;
  return Math.round(initialPoints + (minPoints - initialPoints) * fraction);
}

/**
 * Teams are ranked on points first and, when those are level, on who got there first. Redis sorted
 * sets order by a single number, so both are packed into one score: points are shifted up and the
 * seconds since the event started are subtracted, making an earlier last solve win a tie.
 *
 * `TIE_BREAK_SCALE` is larger than any possible point total's worth of seconds (about 48 days), so
 * the tie-breaker can never eat into the points above it. Events running longer than that keep
 * ranking correctly; solves past day 48 just stop breaking ties between themselves.
 */
const TIE_BREAK_SCALE = 2 ** 22;

export function rankScore(points: number, lastSolveAt: Date | null, eventStartsAt: Date): number {
  if (lastSolveAt === null) return points * TIE_BREAK_SCALE;
  const elapsedSeconds = Math.floor((lastSolveAt.getTime() - eventStartsAt.getTime()) / 1000);
  return points * TIE_BREAK_SCALE - Math.min(TIE_BREAK_SCALE - 1, Math.max(0, elapsedSeconds));
}
