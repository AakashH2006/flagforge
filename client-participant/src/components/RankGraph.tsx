import { useEffect, useMemo, useRef, useState } from 'react';
import { formatClock } from '../lib/game';
import type { ScoreboardHistory } from '../lib/types';

/**
 * Score over time, one stepped line per team. A team's line is flat between solves and jumps when
 * one lands, which is what actually happens — a smooth curve would invent points that were never
 * scored. Hovering anywhere in the plot reads every team's score at that moment, so overlapping
 * lines stay legible, and the scoreboard table below is the same data in text.
 */

/** Eight categorical slots, stepped for this dark surface. Assigned by rank, never cycled. */
export const SERIES_COLORS = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];

export const MAX_SERIES = SERIES_COLORS.length;

const HEIGHT = 320;
const DIRECT_LABEL_LIMIT = 4;
/** Room on the right for the end markers, widened when team names are labelled there. */
const gutter = (labelled: boolean) => (labelled ? 132 : 24);
const PADDING = { top: 16, bottom: 28, left: 52 };
const LABEL_MAX = 16;

type Series = {
  teamId: string;
  name: string;
  color: string;
  /** Cumulative score after each solve, in time order. */
  steps: { time: number; score: number }[];
};

function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(320, entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

/** The team's score at `time`: the last solve at or before it. */
function scoreAt(series: Series, time: number) {
  let score = 0;
  for (const step of series.steps) {
    if (step.time > time) break;
    score = step.score;
  }
  return score;
}

/** Gridline values from 0 up to at least `max`, so no line is ever drawn outside the plot. */
function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((value) => value >= rough) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = 0; value < max; value += step) ticks.push(Math.round(value));
  ticks.push(Math.round(Math.ceil(max / step) * step));
  return ticks;
}

type Props = {
  history: ScoreboardHistory;
  startsAt: string;
  /** Right edge of the plot: now while the event runs, the end time once it's over. */
  endsAt: number;
  highlightTeamId?: string;
};

export function RankGraph({ history, startsAt, endsAt, highlightTeamId }: Props) {
  const [wrapperRef, width] = useMeasuredWidth();
  const [hoverX, setHoverX] = useState<number | null>(null);

  const series = useMemo<Series[]>(
    () =>
      history.teams.slice(0, MAX_SERIES).map((team, index) => ({
        teamId: team.teamId,
        name: team.name,
        color: SERIES_COLORS[index]!,
        steps: team.points.map((point) => ({ time: Date.parse(point.at), score: point.score })),
      })),
    [history],
  );

  const start = Date.parse(startsAt);
  const end = Math.max(endsAt, start + 60_000);
  const maxScore = Math.max(1, ...series.map((entry) => entry.steps.at(-1)?.score ?? 0));
  const ticks = niceTicks(maxScore);
  const top = ticks.at(-1)!;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const yScale = (score: number) => PADDING.top + plotHeight - (score / top) * plotHeight;

  // Labels at the line ends only while they can each sit on their own line. Where teams converge,
  // nudging them apart detaches a label from its line, so the legend carries identity instead.
  const endPositions = series.map((entry) => yScale(entry.steps.at(-1)?.score ?? 0)).sort((a, b) => a - b);
  const crowded = endPositions.some((position, index) => index > 0 && position - endPositions[index - 1]! < 15);
  const labelled = series.length <= DIRECT_LABEL_LIMIT && !crowded;
  const right = gutter(labelled);
  const plotWidth = Math.max(1, width - PADDING.left - right);
  const x = (time: number) => PADDING.left + ((time - start) / (end - start)) * plotWidth;
  const y = yScale;

  const path = (entry: Series) => {
    const commands = [`M ${x(start).toFixed(1)} ${y(0).toFixed(1)}`];
    let score = 0;
    for (const step of entry.steps) {
      commands.push(`H ${x(step.time).toFixed(1)}`, `V ${y(step.score).toFixed(1)}`);
      score = step.score;
    }
    commands.push(`H ${x(end).toFixed(1)}`);
    return { d: commands.join(' '), finalScore: score };
  };

  const hoverTime = hoverX === null ? null : start + ((hoverX - PADDING.left) / plotWidth) * (end - start);
  const readout =
    hoverTime === null
      ? []
      : series
          .map((entry) => ({ entry, score: scoreAt(entry, hoverTime) }))
          .sort((a, b) => b.score - a.score);

  const hasSolves = series.some((entry) => entry.steps.length > 0);
  const timeTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => start + (end - start) * fraction);

  return (
    <section className="panel graph-panel" aria-labelledby="graph-title">
      <div className="panel-head">
        <h2 id="graph-title">Score over time</h2>
        <p className="muted small-text">
          {series.length === 1 ? 'Your team' : `Top ${series.length} teams`} · hover for the standings at any moment
        </p>
      </div>

      {!hasSolves ? (
        <p className="empty muted">No solves yet. The first flag drawn here is the first blood.</p>
      ) : (
        <div className="graph-wrap" ref={wrapperRef}>
          <svg
            className="graph"
            viewBox={`0 0 ${width} ${HEIGHT}`}
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Score over time for the top ${series.length} teams. The scoreboard below lists the same standings.`}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const position = ((event.clientX - bounds.left) / bounds.width) * width;
              setHoverX(Math.min(PADDING.left + plotWidth, Math.max(PADDING.left, position)));
            }}
            onPointerLeave={() => setHoverX(null)}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line className="graph-grid" x1={PADDING.left} x2={width - right} y1={y(tick)} y2={y(tick)} />
                <text className="graph-axis-label" x={PADDING.left - 10} y={y(tick) + 4} textAnchor="end">
                  {tick}
                </text>
              </g>
            ))}

            {timeTicks.map((time) => (
              <text
                key={time}
                className="graph-axis-label"
                x={x(time)}
                y={HEIGHT - 8}
                textAnchor={time === timeTicks[0] ? 'start' : time === timeTicks.at(-1) ? 'end' : 'middle'}
              >
                {formatClock(time)}
              </text>
            ))}

            {series.map((entry) => {
              const { d, finalScore } = path(entry);
              const dimmed = highlightTeamId !== undefined && highlightTeamId !== entry.teamId;
              return (
                <g key={entry.teamId} opacity={dimmed ? 0.45 : 1}>
                  <path className="graph-line" d={d} stroke={entry.color} />
                  <circle className="graph-end" cx={x(end)} cy={y(finalScore)} r={4} fill={entry.color} />
                  {labelled && (
                    <text className="graph-series-label" x={x(end) + 10} y={y(finalScore) + 4}>
                      {entry.name.length > LABEL_MAX ? `${entry.name.slice(0, LABEL_MAX - 1)}…` : entry.name}
                    </text>
                  )}
                </g>
              );
            })}

            {hoverX !== null && (
              <>
                <line className="graph-crosshair" x1={hoverX} x2={hoverX} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} />
                {readout.map(({ entry, score }) => (
                  <circle key={entry.teamId} cx={hoverX} cy={y(score)} r={4} fill={entry.color} className="graph-end" />
                ))}
              </>
            )}
          </svg>

          {hoverTime !== null && (
            <div
              className="graph-tooltip"
              style={{
                left: `${((hoverX! + (hoverX! > width / 2 ? -12 : 12)) / width) * 100}%`,
                transform: hoverX! > width / 2 ? 'translateX(-100%)' : 'none',
              }}
            >
              <div className="graph-tooltip-time mono">{formatClock(hoverTime)}</div>
              {readout.map(({ entry, score }) => (
                <div key={entry.teamId} className="graph-tooltip-row">
                  <span className="graph-key" style={{ background: entry.color }} aria-hidden="true" />
                  <span className="graph-tooltip-score mono">{score}</span>
                  <span className="graph-tooltip-name">{entry.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {series.length > 1 && (
        <ul className="graph-legend">
          {series.map((entry) => (
            <li key={entry.teamId} data-you={entry.teamId === highlightTeamId}>
              <span className="graph-key" style={{ background: entry.color }} aria-hidden="true" />
              {entry.name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
