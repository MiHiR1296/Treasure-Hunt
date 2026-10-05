export type HuntStatus = 'ready' | 'live' | 'paused' | 'ended' | 'archived';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface AdminHunt {
  id: string;
  title: string;
  slug: string;
  status: HuntStatus | string;
  registrationMode?: string;
  registrationOpen?: boolean;
  version?: number;
  lifecycleRevision?: number;
}

export interface LiveAlert {
  id?: string;
  kind: 'stalled' | 'help' | 'photo' | 'fairness' | 'warning' | string;
  label: string;
  detail?: string;
  severity?: 'info' | 'warning' | 'critical';
}

export interface LiveRun {
  id: string;
  runNumber: number;
  status: string;
  score: number;
  elapsedMilliseconds: number | null;
  progress: number | null;
  revision?: number | null;
  timed?: boolean;
  currentCheckpointId?: string | null;
  currentCheckpointLabel?: string | null;
  currentNodeId?: string | null;
  currentNodeType?: string | null;
  parallelMechanic?: boolean;
  routeVariant?: string | null;
  challengeVariant?: string | null;
  completedAt?: string | null;
  eligible?: boolean;
  practice?: boolean;
}

export interface LiveTeam {
  teamId: string;
  code: string;
  displayName: string | null;
  status: 'active' | 'disabled' | 'disqualified' | 'archived' | string;
  approvalStatus: 'pending' | 'approved';
  competitionRevision: number;
  memberNames: string[];
  memberCount: number;
  checkedInCount: number;
  runCount: number;
  activeRun: LiveRun | null;
  bestRun: LiveRun | null;
  alerts: LiveAlert[];
  lastActivityAt?: string | null;
}

export interface PublicBoardAdminState {
  enabled: boolean;
  url?: string | null;
  slug?: string | null;
  title?: string;
  cover?: string | null;
  status: 'live' | 'frozen' | 'final';
  showTeamNames?: boolean;
  mainBoardVisible?: boolean;
  replayBoardVisible?: boolean;
  columns?: string[];
}

export interface LiveOperationsResponse {
  hunt?: AdminHunt;
  generatedAt: string;
  teams: LiveTeam[];
  publicBoard?: PublicBoardAdminState | null;
  alerts?: { help: number; photos: number; stalled: number; fairness: number };
}

export interface Metric {
  label: string;
  value: number | string;
  detail?: string;
}

export interface FunnelStep {
  label: string;
  value: number;
  rate?: number;
}

export interface AnalyticsBreakdownRow {
  id?: string;
  label: string;
  value?: number;
  attempts?: number;
  completions?: number;
  failures?: number;
  hints?: number;
  abandonments?: number;
  medianMilliseconds?: number | null;
  score?: number | null;
  durationMilliseconds?: number | null;
  delta?: number | null;
  status?: string;
  detail?: string;
}

export interface AnalyticsResponse {
  generatedAt?: string;
  summary: Metric[];
  funnel: FunnelStep[];
  improvement: {
    teamsWithReplays: number;
    averageScoreImprovement: number;
    averageTimeImprovementMilliseconds: number | null;
    rows?: AnalyticsBreakdownRow[];
  };
  checkpoints: AnalyticsBreakdownRow[];
  variants: AnalyticsBreakdownRow[];
  contributions: AnalyticsBreakdownRow[];
  recognition: {
    eligibleMembers?: number;
    voters?: number;
    participationRate?: number;
    rows?: AnalyticsBreakdownRow[];
  };
  ties: AnalyticsBreakdownRow[];
  registration: Metric[];
}

export interface RecognitionVoteAudit {
  id: string;
  voterName: string;
  recipientName: string;
  category: string;
  subtype: string;
  answerPath?: string[];
  updatedAt?: string;
}

export interface ContributionAudit {
  id?: string;
  memberId: string;
  memberName: string;
  category: string;
  credit: number;
  evidence?: string;
  occurredAt?: string;
}

export interface RecognitionResultAudit {
  memberId: string;
  memberName: string;
  headlineTitle: string;
  dataTitle?: string;
  peerTitle?: string;
  explanation?: string;
  overridden?: boolean;
}

export interface RecognitionAuditResponse {
  team?: { id: string; code: string; displayName?: string | null };
  run?: { id: string; runNumber: number };
  votes: RecognitionVoteAudit[];
  contributions: ContributionAudit[];
  results: RecognitionResultAudit[];
}

export interface FairnessSummary {
  valid: boolean;
  evaluatedRouteCount?: number;
  maximumScore?: number;
  minimumDurationMinutes?: number;
  maximumDurationMinutes?: number;
  issues?: ValidationIssue[];
}

export interface DraftSummary {
  id: string;
  huntId?: string | null;
  title: string;
  definition: Record<string, unknown>;
  source?: string;
  revision: number;
  generation: string;
  updatedAt: string;
  validation: {
    valid: boolean;
    issues: ValidationIssue[];
    fairness?: FairnessSummary;
  };
}

export interface AuthoringKit {
  version: number;
  schemaUrl: string;
  starterUrl: string;
  annotatedExampleUrl: string;
  prompt: string;
  workflow: string[];
  warning: string;
}
