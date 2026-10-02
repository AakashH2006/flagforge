/** Response shapes from the organizer API (`/api/admin`). See the root README. */

export type Role = 'admin' | 'player';

export type User = { id: string; username: string; role: Role };

export type EventPhase = 'upcoming' | 'live' | 'ended';

export type AdminEvent = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  updatedAt: string;
};

export type Category = 'web' | 'crypto' | 'pwn' | 'forensics' | 'reverse' | 'misc';

export type Attachment = { id: string; filename: string; sizeBytes: number; createdAt: string };

/** Flags are write-only: the API never sends one back, not even to the organizer who set it. */
export type AdminChallenge = {
  id: string;
  eventId: string;
  title: string;
  description: string;
  category: Category;
  isHidden: boolean;
  initialPoints: number;
  minPoints: number;
  decay: number;
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
};

/** What the editor sends. `flag` is left out of a PATCH unless the organizer typed a new one. */
export type ChallengeDraft = {
  title: string;
  description: string;
  category: Category;
  flag?: string;
  isHidden: boolean;
  initialPoints: number;
  minPoints: number;
  decay: number;
};

/** The public scoreboard, used for the solve counts beside each challenge. */
export type ScoreboardChallenge = { id: string; points: number; solves: number };

export type Scoreboard = { totalTeams: number; challenges: ScoreboardChallenge[] };
