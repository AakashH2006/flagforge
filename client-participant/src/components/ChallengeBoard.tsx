import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../lib/game';
import type { Category, Challenge } from '../lib/types';
import { CategoryTag } from './ui';

type Props = { challenges: Challenge[]; onOpen: (challengeId: string) => void };

export function ChallengeBoard({ challenges, onOpen }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [hideSolved, setHideSolved] = useState(false);

  const categories = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => {
        const inCategory = challenges.filter((challenge) => challenge.category === category);
        return { category, total: inCategory.length, solved: inCategory.filter((c) => c.solved).length };
      }).filter(({ total }) => total > 0),
    [challenges],
  );

  // The filter lives in the URL (?category=web) so it survives a refresh and can be shared.
  const requested = searchParams.get('category');
  const active = categories.find(({ category }) => category === requested)?.category ?? null;

  const selectCategory = (category: Category | null) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (category) next.set('category', category);
        else next.delete('category');
        return next;
      },
      { replace: true },
    );

  const solvedCount = challenges.filter((challenge) => challenge.solved).length;
  const visible = challenges.filter(
    (challenge) => (!active || challenge.category === active) && (!hideSolved || !challenge.solved),
  );

  if (challenges.length === 0) {
    return (
      <section className="panel empty">
        <h2>No challenges yet</h2>
        <p className="muted">The organizers haven't published any challenges. Check back soon.</p>
      </section>
    );
  }

  return (
    <section className="board" aria-labelledby="board-title">
      <div className="board-head">
        <h2 id="board-title">Challenges</h2>
        <div className="progress" aria-label={`${solvedCount} of ${challenges.length} solved`}>
          <span className="progress-text mono">
            {solvedCount}/{challenges.length} solved
          </span>
          <span className="progress-track" aria-hidden="true">
            <span className="progress-fill" style={{ width: `${(solvedCount / challenges.length) * 100}%` }} />
          </span>
        </div>
      </div>

      <div className="toolbar">
        <div className="chips" role="group" aria-label="Filter by category">
          <button type="button" className="chip" aria-pressed={active === null} onClick={() => selectCategory(null)}>
            All <span className="chip-count">{challenges.length}</span>
          </button>
          {categories.map(({ category, total, solved }) => (
            <button
              key={category}
              type="button"
              className="chip"
              data-category={category}
              aria-pressed={active === category}
              onClick={() => selectCategory(category)}
            >
              {CATEGORY_LABELS[category]}{' '}
              <span className="chip-count">
                {solved}/{total}
              </span>
            </button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={hideSolved} onChange={(e) => setHideSolved(e.target.checked)} />
          Hide solved
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="empty muted">
          {hideSolved ? 'Everything here is solved. Nice work.' : 'No challenges match this filter.'}
        </p>
      ) : (
        <ul className="challenge-grid">
          {visible.map((challenge) => (
            <li key={challenge.id}>
              <button
                type="button"
                className="challenge-card"
                data-category={challenge.category}
                data-solved={challenge.solved}
                onClick={() => onOpen(challenge.id)}
              >
                <span className="challenge-card-top">
                  <CategoryTag category={challenge.category} />
                  {challenge.solved && (
                    <span className="solved-mark" aria-label="Solved">
                      ✓
                    </span>
                  )}
                </span>
                <span className="challenge-card-title">{challenge.title}</span>
                <span className="challenge-card-foot">
                  <span className="challenge-points mono">{challenge.points} pts</span>
                  <span className="challenge-card-status">
                    {challenge.solves === 0 ? 'Unsolved' : `${challenge.solves} solve${challenge.solves === 1 ? '' : 's'}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
