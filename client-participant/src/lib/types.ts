/** Response shapes from the API. See the root README. */

export type Role = 'admin' | 'player';

export type User = { id: string; username: string; role: Role };

export type EventPhase = 'upcoming' | 'live' | 'ended';

export type CtfEvent = { id: string; name: string; startsAt: string; endsAt: string; phase: EventPhase };

export type Category = 'web' | 'crypto' | 'pwn' | 'forensics' | 'reverse' | 'misc';

/** A file a challenge hands out. Only signed-in players can download it. */
export type Attachment = { id: string; filename: string; sizeBytes: number; createdAt: string };

export type Challenge = {
  id: string;
  title: string;
  description: string;
  category: Category;
  attachments: Attachment[];
  /** What the challenge is worth right now. Falls as more teams solve it. */
  points: number;
  solves: number;
  solved: boolean;
  solvedAt: string | null;
};

export type ScoreboardTeam = {
  rank: number;
  teamId: string;
  name: string;
  score: number;
  solves: number;
  firstBloods: number;
  lastSolveAt: string | null;
};

export type ScoreboardChallenge = {
  id: string;
  title: string;
  category: Category;
  points: number;
  solves: number;
  firstBlood: { teamId: string; name: string; solvedAt: string } | null;
};

export type Scoreboard = {
  eventId: string;
  updatedAt: string;
  totalTeams: number;
  teams: ScoreboardTeam[];
  challenges: ScoreboardChallenge[];
};

export type ScoreboardHistory = {
  eventId: string;
  teams: { teamId: string; name: string; points: { at: string; score: number }[] }[];
};

export type TeamMember = { id: string; username: string; joinedAt: string };

export type Team = { id: string; name: string; inviteCode: string; members: TeamMember[] };

export type SubmissionResult = 'correct' | 'incorrect' | 'already_solved';
