import { useState } from 'react';
import { apiRequest, toApiError } from '../lib/api';
import { challengePoints } from '../lib/format';
import type { AdminChallenge, Category, ScoreboardChallenge } from '../lib/types';
import { CategoryTag, ConfirmDialog } from './ui';

/**
 * Every challenge in the event, grouped by category. Each row shows what it is worth right now
 * and whether players can see it, which are the two things an organizer checks before an event.
 */
export function ChallengeTable({
  eventId,
  challenges,
  solves,
  onEdit,
  onChanged,
}: {
  eventId: string;
  challenges: AdminChallenge[];
  /** Live solve counts from the public scoreboard, empty before the event starts. */
  solves: Map<string, ScoreboardChallenge>;
  onEdit: (challenge: AdminChallenge) => void;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminChallenge | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const byCategory = new Map<Category, AdminChallenge[]>();
  for (const challenge of challenges) {
    const list = byCategory.get(challenge.category);
    if (list) list.push(challenge);
    else byCategory.set(challenge.category, [challenge]);
  }

  async function togglePublished(challenge: AdminChallenge) {
    setBusyId(challenge.id);
    setError(null);
    try {
      await apiRequest(`/api/admin/events/${eventId}/challenges/${challenge.id}`, {
        method: 'PATCH',
        body: { isHidden: !challenge.isHidden },
      });
      onChanged();
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(challenge: AdminChallenge) {
    setDeletePending(true);
    setDeleteError(null);
    try {
      await apiRequest(`/api/admin/events/${eventId}/challenges/${challenge.id}`, { method: 'DELETE' });
      setDeleting(null);
      onChanged();
    } catch (err) {
      setDeleteError(toApiError(err).message);
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div className="stack">
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {[...byCategory].map(([category, group]) => (
        <section key={category} className="panel">
          <h2 className="category-head">
            <CategoryTag category={category} />
            <span className="muted small-text">
              {group.length} challenge{group.length === 1 ? '' : 's'}
            </span>
          </h2>
          <ul className="challenge-rows">
            {group.map((challenge) => {
              const live = solves.get(challenge.id);
              const points = live?.points ?? challengePoints(challenge, 0);
              return (
                <li key={challenge.id} className="challenge-row" data-hidden={challenge.isHidden}>
                  <div className="challenge-row-main">
                    <button type="button" className="link-button challenge-name" onClick={() => onEdit(challenge)}>
                      {challenge.title}
                    </button>
                    <p className="muted small-text">
                      <span className="mono">{points} pts</span>
                      {live ? ` · ${live.solves} solve${live.solves === 1 ? '' : 's'}` : ' · no solves yet'}
                      {challenge.attachments.length > 0 &&
                        ` · ${challenge.attachments.length} file${challenge.attachments.length === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  <span className={`badge ${challenge.isHidden ? 'badge-upcoming' : 'badge-live'}`}>
                    {challenge.isHidden ? 'Draft' : 'Published'}
                  </span>
                  <div className="challenge-row-actions">
                    <button
                      type="button"
                      className="button ghost small"
                      disabled={busyId === challenge.id}
                      onClick={() => void togglePublished(challenge)}
                    >
                      {challenge.isHidden ? 'Publish' : 'Unpublish'}
                    </button>
                    <button type="button" className="button ghost small" onClick={() => onEdit(challenge)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button ghost small danger-text"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(challenge);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {deleting && (
        <ConfirmDialog
          title="Delete challenge"
          confirmLabel="Delete it"
          pending={deletePending}
          error={deleteError}
          onConfirm={() => void remove(deleting)}
          onClose={() => setDeleting(null)}
        >
          <strong>{deleting.title}</strong> goes for good, along with its files and every solve recorded against
          it. Unpublish it instead if you only want it out of sight.
        </ConfirmDialog>
      )}
    </div>
  );
}
