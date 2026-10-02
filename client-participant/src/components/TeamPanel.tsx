import { useState } from 'react';
import { apiRequest, toApiError } from '../lib/api';
import type { Query } from '../lib/hooks';
import type { EventPhase, Team } from '../lib/types';
import { ErrorNote } from './ui';

type Props = {
  eventBase: string;
  phase: EventPhase;
  query: Query<{ team: Team }>;
  onJoined: () => void;
};

export function TeamPanel({ eventBase, phase, query, onJoined }: Props) {
  if (query.data) return <TeamCard team={query.data.team} />;

  if (query.error && query.error.status !== 404) {
    return (
      <section className="panel">
        <h2 className="panel-title">Your team</h2>
        <ErrorNote error={query.error} onRetry={query.reload} />
      </section>
    );
  }

  if (!query.error) {
    return (
      <section className="panel">
        <h2 className="panel-title">Your team</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }

  // 404: not on a team for this event.
  if (phase === 'ended') {
    return (
      <section className="panel">
        <h2 className="panel-title">Your team</h2>
        <p className="muted">You didn't join a team for this event.</p>
      </section>
    );
  }
  return <TeamSetup eventBase={eventBase} onJoined={onJoined} />;
}

function TeamCard({ team }: { team: Team }) {
  const [copied, setCopied] = useState(false);

  async function copyInviteCode() {
    try {
      await navigator.clipboard.writeText(team.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied. The code is still visible to copy by hand.
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Your team</h2>
      <p className="team-name">{team.name}</p>

      <div className="invite">
        <span className="label">Invite code</span>
        <div className="invite-row">
          <code className="invite-code">{team.inviteCode}</code>
          <button type="button" className="button ghost small" onClick={copyInviteCode}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="hint">Share it with teammates. Solves count for the whole team.</p>
      </div>

      <span className="label">
        Members <span className="muted">({team.members.length})</span>
      </span>
      <ul className="members">
        {team.members.map((member) => (
          <li key={member.id}>{member.username}</li>
        ))}
      </ul>
    </section>
  );
}

type Form = 'create' | 'join';

function TeamSetup({ eventBase, onJoined }: { eventBase: string; onJoined: () => void }) {
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [pending, setPending] = useState<Form | null>(null);
  const [error, setError] = useState<{ form: Form; message: string } | null>(null);

  async function run(form: Form, request: () => Promise<unknown>) {
    setPending(form);
    setError(null);
    try {
      await request();
      onJoined();
    } catch (err) {
      setError({ form, message: toApiError(err).message });
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Join the game</h2>
      <p className="muted small-text">You need a team to submit flags. Play solo by making a team of one.</p>

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run('create', () => apiRequest(`${eventBase}/teams`, { method: 'POST', body: { name } }));
        }}
      >
        <label className="field">
          <span className="label">Create a team</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team name"
            minLength={2}
            maxLength={48}
            required
          />
        </label>
        {error?.form === 'create' && <p className="field-error">{error.message}</p>}
        <button type="submit" className="button" disabled={pending !== null || name.trim().length < 2}>
          {pending === 'create' ? 'Creating…' : 'Create team'}
        </button>
      </form>

      <div className="divider">
        <span>or</span>
      </div>

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run('join', () => apiRequest(`${eventBase}/teams/join`, { method: 'POST', body: { inviteCode } }));
        }}
      >
        <label className="field">
          <span className="label">Join with an invite code</span>
          <input
            className="input mono"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="Invite code"
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        {error?.form === 'join' && <p className="field-error">{error.message}</p>}
        <button type="submit" className="button ghost" disabled={pending !== null || !inviteCode.trim()}>
          {pending === 'join' ? 'Joining…' : 'Join team'}
        </button>
      </form>
    </section>
  );
}
