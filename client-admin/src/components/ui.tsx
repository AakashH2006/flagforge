import { type ReactNode, useEffect, useRef } from 'react';
import type { ApiError } from '../lib/api';
import { CATEGORY_LABELS, formatDuration } from '../lib/format';
import { useTick } from '../lib/hooks';
import type { Category, EventPhase } from '../lib/types';

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loader" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="banner banner-danger" role="alert">
      <div>{error.message}</div>
      {onRetry && (
        <button type="button" className="button ghost small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Banner({
  tone,
  title,
  children,
  className = '',
}: {
  tone: 'success' | 'danger' | 'warning' | 'info' | 'muted';
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`banner banner-${tone} ${className}`}>
      <div>
        {title && <strong className="banner-title">{title}</strong>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

const PHASE_LABELS: Record<EventPhase, string> = { upcoming: 'Upcoming', live: 'Live', ended: 'Ended' };

export function PhaseBadge({ phase }: { phase: EventPhase }) {
  return <span className={`badge badge-${phase}`}>{PHASE_LABELS[phase]}</span>;
}

/** "Starts in …" or "Ends in …", kept roughly current. */
export function EventTiming({ event, phase }: { event: { startsAt: string; endsAt: string }; phase: EventPhase }) {
  useTick(phase === 'ended' ? null : 30_000);
  const now = Date.now();
  if (phase === 'upcoming') return <>Starts in {formatDuration(Date.parse(event.startsAt) - now)}</>;
  if (phase === 'live') return <>Ends in {formatDuration(Date.parse(event.endsAt) - now)}</>;
  return <>Finished</>;
}

export function CategoryTag({ category }: { category: Category }) {
  return (
    <span className="cat-tag" data-category={category}>
      {CATEGORY_LABELS[category]}
    </span>
  );
}

/**
 * A modal shell. Deleting an event or a challenge cannot be undone, so those go through
 * `ConfirmDialog` rather than a native confirm() the page can't style or test.
 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);

  return (
    <dialog ref={dialogRef} className={`dialog${wide ? ' dialog-wide' : ''}`} aria-label={title} onClose={onClose}>
      <div className="dialog-body">
        <header className="dialog-head">
          <h2 className="dialog-title">{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={() => dialogRef.current?.close()}
          >
            ×
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function ConfirmDialog({
  title,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <p>{children}</p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="row-end">
          <button type="button" className="button ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="button danger" onClick={onConfirm} disabled={pending} data-autofocus>
            {pending ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
