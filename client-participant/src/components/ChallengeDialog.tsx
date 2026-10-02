import { useEffect, useRef, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiRequest, downloadFile, toApiError } from '../lib/api';
import { formatBytes, formatDateTime } from '../lib/game';
import { useTick } from '../lib/hooks';
import type { Attachment, Challenge, SubmissionResult } from '../lib/types';
import { Banner, CategoryTag } from './ui';

type SolveResult = Exclude<SubmissionResult, 'incorrect'>;

type Props = {
  challenge: Challenge;
  eventBase: string;
  /** Why this player can't submit right now (no team, event ended), or null if they can. */
  blockedReason: string | null;
  /** The flag rate limit is per user across all challenges, so the page tracks it. */
  rateLimitedUntil: number;
  onRateLimited: (until: number) => void;
  onSolved: () => void;
  onClose: () => void;
};

// Descriptions are Markdown written by organizers. react-markdown doesn't render raw HTML,
// so a description can't inject scripts.
const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export function ChallengeDialog({
  challenge,
  eventBase,
  blockedReason,
  rateLimitedUntil,
  onRateLimited,
  onSolved,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [solveResult, setSolveResult] = useState<SolveResult | null>(null);
  const [awarded, setAwarded] = useState<number>();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);

  function handleSolved(result: SolveResult, points?: number) {
    setSolveResult(result);
    setAwarded(points);
    onSolved();
    // The form unmounts, so move focus somewhere sensible inside the dialog.
    requestAnimationFrame(() => closeRef.current?.focus());
  }

  let footer;
  if (solveResult === 'correct') {
    footer = (
      <Banner tone="success" title={awarded === undefined ? 'Correct!' : `Correct! +${awarded} points`} className="pop">
        Flag accepted. {challenge.title} is solved for your whole team.
      </Banner>
    );
  } else if (solveResult === 'already_solved') {
    footer = (
      <Banner tone="info" title="Already solved">
        A teammate got there first. Solves are shared across your team.
      </Banner>
    );
  } else if (challenge.solved) {
    footer = (
      <Banner tone="success" title="Solved">
        Your team solved this {challenge.solvedAt ? `on ${formatDateTime(challenge.solvedAt)}` : 'already'}.
      </Banner>
    );
  } else if (blockedReason) {
    footer = <Banner tone="muted">{blockedReason}</Banner>;
  } else {
    footer = (
      <SubmissionForm
        submitUrl={`${eventBase}/challenges/${challenge.id}/submissions`}
        rateLimitedUntil={rateLimitedUntil}
        onRateLimited={onRateLimited}
        onSolved={handleSolved}
      />
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="challenge-title"
      onClose={onClose}
      onClick={(e) => {
        // Close on backdrop clicks. The backdrop counts as the dialog element, but lies outside its box.
        const dialog = e.currentTarget;
        if (e.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        const outside =
          e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
        if (outside) dialog.close();
      }}
    >
      <div className="dialog-body" data-category={challenge.category}>
        <header className="dialog-head">
          <div>
            <span className="dialog-tags">
              <CategoryTag category={challenge.category} />
              <span className="challenge-points mono">{challenge.points} pts</span>
            </span>
            <h2 id="challenge-title" className="dialog-title">
              {challenge.title}
            </h2>
            <p className="muted small-text">
              {challenge.solves === 0
                ? 'Nobody has solved this yet — first blood is worth full points.'
                : `Solved by ${challenge.solves} team${challenge.solves === 1 ? '' : 's'}. Its value falls as more teams solve it.`}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={() => dialogRef.current?.close()}
          >
            ×
          </button>
        </header>

        <div className="markdown">
          {challenge.description.trim() ? (
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {challenge.description}
            </Markdown>
          ) : (
            <p className="muted">No description.</p>
          )}
        </div>

        {challenge.attachments.length > 0 && (
          <AttachmentList
            attachments={challenge.attachments}
            basePath={`${eventBase}/challenges/${challenge.id}/attachments`}
          />
        )}

        <footer className="dialog-foot">{footer}</footer>
      </div>
    </dialog>
  );
}

/** The challenge's handouts. Each one is fetched with the session token and saved by the browser. */
function AttachmentList({ attachments, basePath }: { attachments: Attachment[]; basePath: string }) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(attachment: Attachment) {
    setDownloading(attachment.id);
    setError(null);
    try {
      await downloadFile(`${basePath}/${attachment.id}`, attachment.filename);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section className="attachments">
      <h3 className="label">{attachments.length === 1 ? 'File' : 'Files'}</h3>
      <ul className="attachment-list">
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            <button
              type="button"
              className="attachment"
              disabled={downloading !== null}
              onClick={() => void download(attachment)}
            >
              <span className="attachment-icon" aria-hidden="true">
                ↓
              </span>
              <span className="attachment-name">{attachment.filename}</span>
              <span className="attachment-size mono">
                {downloading === attachment.id ? 'Saving…' : formatBytes(attachment.sizeBytes)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

type Feedback = { kind: 'incorrect' } | { kind: 'error'; message: string };

function SubmissionForm({
  submitUrl,
  rateLimitedUntil,
  onRateLimited,
  onSolved,
}: {
  submitUrl: string;
  rateLimitedUntil: number;
  onRateLimited: (until: number) => void;
  onSolved: (result: SolveResult, points?: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [flag, setFlag] = useState('');
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [shaking, setShaking] = useState(false);

  const msLeft = rateLimitedUntil - Date.now();
  const limited = msLeft > 0;
  useTick(limited ? 250 : null);

  async function submit() {
    if (pending || limited || !flag.trim()) return;
    setPending(true);
    setFeedback(null);
    try {
      const { result, points } = await apiRequest<{ result: SubmissionResult; points?: number }>(submitUrl, {
        method: 'POST',
        body: { flag },
      });
      if (result === 'incorrect') {
        setFeedback({ kind: 'incorrect' });
        setShaking(true);
        inputRef.current?.select();
      } else {
        onSolved(result, points);
      }
    } catch (err) {
      const error = toApiError(err);
      if (error.status === 429) onRateLimited(Date.now() + (error.retryAfterSeconds ?? 60) * 1000);
      else setFeedback({ kind: 'error', message: error.message });
    } finally {
      setPending(false);
    }
  }

  let message = null;
  if (limited) {
    message = (
      <Banner tone="warning" title="Slow down">
        Too many attempts. You can submit again in <span className="mono">{Math.ceil(msLeft / 1000)}s</span>.
      </Banner>
    );
  } else if (feedback?.kind === 'incorrect') {
    message = (
      <Banner tone="danger" title="Incorrect flag">
        That's not it. Flags are case-sensitive.
      </Banner>
    );
  } else if (feedback?.kind === 'error') {
    message = <Banner tone="danger">{feedback.message}</Banner>;
  }

  return (
    <form
      className="flag-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="flag-input" className="label">
        Submit a flag
      </label>
      <div className="flag-row">
        <input
          id="flag-input"
          ref={inputRef}
          data-autofocus
          className={`input flag-input${shaking ? ' shake' : ''}`}
          onAnimationEnd={() => setShaking(false)}
          value={flag}
          onChange={(e) => {
            setFlag(e.target.value);
            if (feedback) setFeedback(null);
          }}
          placeholder="CTF{...}"
          maxLength={256}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          readOnly={pending}
          aria-invalid={feedback?.kind === 'incorrect'}
          aria-describedby="flag-feedback"
        />
        <button type="submit" className="button" disabled={pending || limited || !flag.trim()}>
          {pending ? 'Checking…' : 'Submit'}
        </button>
      </div>
      <div id="flag-feedback" aria-live="polite">
        {message}
      </div>
    </form>
  );
}
