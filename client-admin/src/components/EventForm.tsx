import { useState } from 'react';
import { apiRequest, toApiError } from '../lib/api';
import { formatDuration, fromLocalInput, toLocalInput } from '../lib/format';
import type { AdminEvent } from '../lib/types';

const HOUR = 60 * 60 * 1000;

/** A new event starts on the next whole hour and runs for two days, which is a normal CTF. */
function defaultWindow() {
  const start = new Date(Math.ceil((Date.now() + HOUR) / HOUR) * HOUR);
  return {
    startsAt: toLocalInput(start.toISOString()),
    endsAt: toLocalInput(new Date(start.getTime() + 48 * HOUR).toISOString()),
  };
}

/**
 * Creates an event, or edits the one it is given. The same three fields either way, so the
 * wizard and the settings panel are one component.
 */
export function EventForm({
  event,
  submitLabel,
  onSaved,
  onCancel,
}: {
  event?: AdminEvent;
  submitLabel: string;
  onSaved: (event: AdminEvent) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(event?.name ?? '');
  const initial = event ? { startsAt: toLocalInput(event.startsAt), endsAt: toLocalInput(event.endsAt) } : defaultWindow();
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [endsAt, setEndsAt] = useState(initial.endsAt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lengthMs = Date.parse(endsAt) - Date.parse(startsAt);
  const windowIsBackwards = Number.isFinite(lengthMs) && lengthMs <= 0;

  async function submit() {
    if (windowIsBackwards) return;
    setPending(true);
    setError(null);
    try {
      const body = { name, startsAt: fromLocalInput(startsAt), endsAt: fromLocalInput(endsAt) };
      const saved = await apiRequest<{ event: AdminEvent }>(
        event ? `/api/admin/events/${event.id}` : '/api/admin/events',
        { method: event ? 'PATCH' : 'POST', body },
      );
      onSaved(saved.event);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="field">
        <span className="label">Event name</span>
        <input
          className="input"
          data-autofocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Autumn Qualifiers 2026"
          maxLength={120}
          required
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span className="label">Starts</span>
          <input
            className="input"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="label">Ends</span>
          <input
            className="input"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            required
          />
        </label>
      </div>

      <p className="hint">
        {windowIsBackwards ? (
          <span className="field-error">The event has to end after it starts.</span>
        ) : Number.isFinite(lengthMs) ? (
          <>
            Runs for {formatDuration(lengthMs)}. Players can see the challenge list from the moment it starts, and
            flags stop being accepted when it ends.
          </>
        ) : (
          'Times are in your own time zone.'
        )}
      </p>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <div className="row-end">
        {onCancel && (
          <button type="button" className="button ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
        )}
        <button type="submit" className="button" disabled={pending || windowIsBackwards}>
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
