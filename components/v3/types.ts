import type { Feedback, GameCommand, PlayerView } from '@/lib/engine/types';

export type RegistrationMode = 'self-serve' | 'organizer-assigned' | 'rostered';

export interface HuntSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  registrationMode: RegistrationMode;
  registrationOpen: boolean;
  minTeamSize: number;
  maxTeamSize: number;
  coverUrl?: string;
}

export interface SessionRunSummary {
  id: string;
  runNumber: number;
  status: 'waiting' | 'active' | 'completed' | 'abandoned' | 'disqualified';
  practice: boolean;
  eligible: boolean;
  score: number;
  elapsedMilliseconds: number | null;
  progress?: number;
  currentCheckpointId?: string | null;
  startedAt?: string;
  completedAt?: string | null;
}

export interface TeamSessionSummary {
  hunt: {
    id: string;
    title: string;
    slug: string;
    status: string;
    registrationMode: RegistrationMode;
  };
  team: {
    id: string;
    code: string;
    displayName: string | null;
    label: string;
    status: string;
    approvalStatus: 'pending' | 'approved';
    competitionRevision: number;
    registrationSource: RegistrationMode;
  };
  member: { id: string; name: string };
  members: Array<{ id: string; name: string; checkedIn: boolean }>;
  activeRun: SessionRunSummary | null;
  /** This member joined after a frozen run began and can enter the team's next run. */
  waitingForNextRun: boolean;
  latestRun: SessionRunSummary | null;
  bestRun: SessionRunSummary | null;
  completedOfficialRuns: number;
  /** All non-practice attempts, including timed-out or abandoned runs. */
  officialAttemptCount: number;
  /** Policy slots used after audited disqualification replacements. */
  officialAttemptSlotsUsed: number;
  /** Practice is a one-way boundary: this identity can never become official again. */
  hasPracticeRun: boolean;
  /** Null means unlimited official attempts; practice-locked identities report zero. */
  remainingOfficialRuns: number | null;
  settings: {
    minTeamSize: number;
    maxTeamSize: number;
    runPolicy: { mode: 'disabled' | 'capped' | 'unlimited' | 'practice-only'; maxOfficialRuns?: number };
  };
}

export interface PlayerFeatures {
  recognition?: {
    enabled: boolean;
    peerVotingEnabled?: boolean;
  };
  socialShare?: {
    enabled: boolean;
    organizerHandle?: string;
    campaignHashtag?: string;
    allowPersonalTitle?: boolean;
  };
  publicBoard?: {
    enabled: boolean;
    slug?: string;
  };
  parallelMechanics?: PublicParallelMechanic[];
}

export interface PublicParallelMechanic {
  id: string;
  checkpointId: string;
  nodeId: string;
  timeWindowSeconds: number;
  lanes: Array<{ id: string; label: string; type: 'qr' | 'code' | 'gps' | 'photo' }>;
  completedLanes: Array<{ laneId: string; memberId: string; memberName: string; occurredAt: string }>;
  remainingLaneIds: string[];
  windowExpiresAt?: string;
  windowRemainingSeconds?: number;
  windowPaused?: boolean;
}

export type V3PlayerView = PlayerView & {
  bonusScore: number;
  runId: string;
  runNumber: number;
  practice: boolean;
  eligible: boolean;
  team: { id: string; code: string; displayName: string | null; label: string };
  member: { id: string; name: string };
  features?: PlayerFeatures;
};

export interface PendingRunCommand {
  runId: string;
  requestId: string;
  command: GameCommand;
}

export interface RunCommandResponse {
  view: V3PlayerView;
  feedback: Feedback;
}

export interface MainLeaderboardEntry {
  rank: number;
  isOwnTeam: boolean;
  teamCode: string;
  teamName?: string;
  score: number;
  bestAttemptNumber?: number;
  eligibleCompletedRuns: number;
  runCount: number;
  status: 'registered' | 'waiting' | 'active' | 'completed';
  provisional: boolean;
  progress?: { completed: number; total: number };
  visibleElapsedMilliseconds?: number;
}

export interface ReplayLeaderboardEntry extends MainLeaderboardEntry {
  runCount: number;
  bestElapsedMilliseconds: number;
  scoreImprovementFromFirst: number;
  timeImprovementFromFirstMilliseconds: number;
}

export interface TeamLeaderboards {
  hunt: { id: string; title: string };
  main: { visible: boolean; entries: MainLeaderboardEntry[] };
  replay: {
    enabled: boolean;
    visible: boolean;
    unlocked: boolean;
    unlockMessage?: string;
    entries: ReplayLeaderboardEntry[];
  };
}

export type ContributionCategory =
  | 'trailblazer'
  | 'puzzle_ace'
  | 'codebreaker'
  | 'eagle_eye'
  | 'clutch_player'
  | 'team_spark';

export type PeerRecognitionCategory = 'puzzle_power' | 'trail_speed' | 'clue_craft' | 'crew_energy';
export type PeerRecognitionSubtype =
  | 'word_hunter' | 'pattern_breaker' | 'number_wizard'
  | 'first_finder' | 'swift_scout' | 'qr_sprinter'
  | 'detail_detective' | 'logic_linker' | 'riddle_reader'
  | 'calm_captain' | 'momentum_maker' | 'helping_hand';

export interface ContributionStanding {
  teamMemberId: string;
  displayName: string;
  rank: number;
  totalCredit: number;
  categoryCredits: Record<ContributionCategory, number>;
  evidenceCount: number;
}

export interface VisibleRecognitionResult {
  memberId: string;
  headlineTitle: string;
  dataAchievement: {
    title: string;
    category?: ContributionCategory;
    credit?: number;
    evidenceCount?: number;
    evidenceSummary?: string[];
  };
  peerRecognition: null | {
    title: string;
    category?: PeerRecognitionCategory;
    subtype?: PeerRecognitionSubtype;
    votes?: number;
    explanation?: string;
  };
  organizerExplanation?: string;
}

export interface RecognitionView {
  enabled: boolean;
  scope?: 'run' | 'all';
  standings: ContributionStanding[];
  results: VisibleRecognitionResult[];
  voting?: {
    enabled: boolean;
    open: boolean;
    closesAt: string | null;
    ownVote: null | {
      recipientMemberId: string;
      category: PeerRecognitionCategory;
      subtype: PeerRecognitionSubtype;
    };
    options: Partial<Record<PeerRecognitionCategory, PeerRecognitionSubtype[]>>;
    teammates: Array<{ teamMemberId: string; displayName: string }>;
  };
}

/** Deliberately contains team-level fields only. */
export interface PublicBoardRow {
  rank?: number;
  teamCode?: string;
  teamName?: string;
  points?: number;
  progress?: { completed: number; total: number };
  runs?: number;
  elapsedMilliseconds?: number;
  status?: string;
  scoreImprovementFromFirst?: number;
  timeImprovementFromFirstMilliseconds?: number;
}

export interface PublicBoardView {
  title: string;
  cover?: string;
  status: 'live' | 'frozen' | 'final';
  columns: string[];
  generatedAt: string;
  frozen: boolean;
  main?: PublicBoardRow[];
  replay?: PublicBoardRow[];
  rows?: PublicBoardRow[];
}

export const contributionLabels: Record<ContributionCategory, string> = {
  trailblazer: 'Trailblazer',
  puzzle_ace: 'Puzzle Ace',
  codebreaker: 'Codebreaker',
  eagle_eye: 'Eagle Eye',
  clutch_player: 'Clutch Player',
  team_spark: 'Team Spark',
};

export const peerCategoryLabels: Record<PeerRecognitionCategory, { title: string; prompt: string; icon: string }> = {
  puzzle_power: { title: 'Puzzle Power', prompt: 'They cracked the things that made everyone think.', icon: '◈' },
  trail_speed: { title: 'Trail Speed', prompt: 'They found the route and kept the team moving.', icon: '→' },
  clue_craft: { title: 'Clue Craft', prompt: 'They spotted details and connected the clues.', icon: '⌕' },
  crew_energy: { title: 'Crew Energy', prompt: 'They made the whole team better.', icon: '✦' },
};

export const peerSubtypeLabels: Record<PeerRecognitionSubtype, string> = {
  word_hunter: 'Word Hunter',
  pattern_breaker: 'Pattern Breaker',
  number_wizard: 'Number Wizard',
  first_finder: 'First Finder',
  swift_scout: 'Swift Scout',
  qr_sprinter: 'QR Sprinter',
  detail_detective: 'Detail Detective',
  logic_linker: 'Logic Linker',
  riddle_reader: 'Riddle Reader',
  calm_captain: 'Calm Captain',
  momentum_maker: 'Momentum Maker',
  helping_hand: 'Helping Hand',
};
