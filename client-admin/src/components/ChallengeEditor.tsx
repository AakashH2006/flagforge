import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiRequest, toApiError } from '../lib/api';
import { CATEGORIES, CATEGORY_LABELS, challengePoints } from '../lib/format';
import type { AdminChallenge, Category, ChallengeDraft } from '../lib/types';
import { AttachmentManager } from './AttachmentManager';
import { Modal } from './ui';

const BLANK: ChallengeDraft = {
  title: '',
  description: '',
  category: 'web',
  flag: '',
  isHidden: true,
  initialPoints: 500,
  minPoints: 100,
  decay: 25,
};

const draftFrom = (challenge: AdminChallenge): ChallengeDraft => ({
  title: challenge.title,
  description: challenge.description,
  category: challenge.category,
  flag: '',
  isHidden: challenge.isHidden,
  initialPoints: challenge.initialPoints,
  minPoints: challenge.minPoints,
  decay: challenge.decay,
});

/**
 * Writes a challenge. Creating one and editing one are the same form; the difference is that an
 * existing challenge already has a flag (which the API never sends back), so the flag field is
 * optional on an edit and leaving it blank keeps the current one.
 */
export function ChallengeEditor({
  eventId,
  challenge,
  onClose,
  onSaved,
}: {
  eventId: string;
  challenge: AdminChallenge | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ChallengeDraft>(challenge ? draftFrom(challenge) : BLANK);
  const [preview, setPreview] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Uploads save straight away, so the list the modal shows is its own after the first change.
  const [attachments, setAttachments] = useState(challenge?.attachments ?? []);
  const [filesChanged, setFilesChanged] = useState(false);

  const set = <K extends keyof ChallengeDraft>(key: K, value: ChallengeDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const pointsAreBackwards = draft.minPoints > draft.initialPoints;

  async function save() {
    if (pointsAreBackwards) return;
    setPending(true);
    setError(null);
    try {
      // An edit with an empty flag field leaves the stored flag alone. On a new challenge the
      // field is required, so there is always one to send.
      const { flag, ...fields } = draft;
      const trimmed = flag?.trim();
      const body = trimmed ? { ...fields, flag: trimmed } : fields;
      await apiRequest(
        challenge ? `/api/admin/events/${eventId}/challenges/${challenge.id}` : `/api/admin/events/${eventId}/challenges`,
        { method: challenge ? 'PATCH' : 'POST', body },
      );
      onSaved();
    } catch (err) {
      setError(toApiError(err).message);
      setPending(false);
    }
  }

  return (
    <Modal
      title={challenge ? 'Edit challenge' : 'New challenge'}
      wide
      onClose={() => {
        // Files are saved as they are chosen, so the list behind the modal has to refresh even
        // when the organizer closes without saving the fields.
        if (filesChanged) onSaved();
        else onClose();
      }}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field-row">
          <label className="field grow">
            <span className="label">Title</span>
            <input
              className="input"
              data-autofocus
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Packet Whisperer"
              maxLength={120}
              required
            />
          </label>
          <label className="field">
            <span className="label">Category</span>
            <select
              className="input"
              value={draft.category}
              onChange={(e) => set('category', e.target.value as Category)}
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          <div className="row-between">
            <span className="label">Description</span>
            <button type="button" className="link-button" onClick={() => setPreview(!preview)}>
              {preview ? 'Edit Markdown' : 'Preview'}
            </button>
          </div>
          {preview ? (
            <div className="markdown preview-box">
              {draft.description.trim() ? (
                <Markdown remarkPlugins={[remarkGfm]}>{draft.description}</Markdown>
              ) : (
                <p className="muted">Nothing to preview yet.</p>
              )}
            </div>
          ) : (
            <textarea
              className="input textarea"
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder={'What the players see. Markdown works:\n\n`code`, **bold**, [links](https://example.com)'}
              maxLength={20_000}
              rows={8}
            />
          )}
        </div>

        <label className="field">
          <span className="label">Flag</span>
          <input
            className="input mono"
            value={draft.flag ?? ''}
            onChange={(e) => set('flag', e.target.value)}
            placeholder={challenge ? 'Leave blank to keep the current flag' : 'CTF{...}'}
            maxLength={256}
            autoComplete="off"
            spellCheck={false}
            required={!challenge}
          />
          <span className="hint">
            Stored as an HMAC and never shown again, so write it down somewhere. Flags are case-sensitive and
            surrounding spaces are trimmed.
          </span>
        </label>

        <ScoringFields draft={draft} set={set} backwards={pointsAreBackwards} />

        <label className="check">
          <input
            type="checkbox"
            checked={!draft.isHidden}
            onChange={(e) => set('isHidden', !e.target.checked)}
          />
          <span>
            Published — players can see it and submit flags.
            <span className="hint"> Unpublished challenges are invisible and score nothing.</span>
          </span>
        </label>

        {challenge ? (
          <AttachmentManager
            basePath={`/api/admin/events/${eventId}/challenges/${challenge.id}/attachments`}
            attachments={attachments}
            onChanged={(next) => {
              setAttachments(next);
              setFilesChanged(true);
            }}
          />
        ) : (
          <p className="hint">Save the challenge first and you can attach files to it.</p>
        )}

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}

        <div className="row-end">
          <button type="button" className="button ghost" onClick={filesChanged ? onSaved : onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={pending || pointsAreBackwards}>
            {pending ? 'Saving…' : challenge ? 'Save challenge' : 'Create challenge'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** The three dynamic-scoring numbers, with what they add up to spelled out underneath. */
function ScoringFields({
  draft,
  set,
  backwards,
}: {
  draft: ChallengeDraft;
  set: <K extends keyof ChallengeDraft>(key: K, value: ChallengeDraft[K]) => void;
  backwards: boolean;
}) {
  const number = (key: 'initialPoints' | 'minPoints' | 'decay', label: string, hint: string, min: number) => (
    <label className="field">
      <span className="label">{label}</span>
      <input
        className="input"
        type="number"
        value={draft[key]}
        min={min}
        max={10_000}
        onChange={(e) => set(key, Number(e.target.value))}
        required
      />
      <span className="hint">{hint}</span>
    </label>
  );

  const at = (solves: number) => challengePoints(draft, solves);

  return (
    <fieldset className="scoring">
      <legend className="label">Scoring</legend>
      <div className="field-row">
        {number('initialPoints', 'Starting points', 'What the first solve is worth.', 1)}
        {number('minPoints', 'Floor', 'It never drops below this. Set it equal to the start for a fixed value.', 0)}
        {number('decay', 'Decay', 'Solves after the first that take it all the way down.', 1)}
      </div>
      {backwards ? (
        <p className="field-error">The floor cannot be above the starting points.</p>
      ) : (
        <p className="hint">
          Worth <span className="mono">{at(1)}</span> to the first team, <span className="mono">{at(5)}</span> after
          5 solves, <span className="mono">{at(15)}</span> after 15, and{' '}
          <span className="mono">{at(draft.decay + 1)}</span> once {draft.decay + 1} teams have it.
        </p>
      )}
    </fieldset>
  );
}
