import type {
  CheckpointDefinition,
  GPSRegion,
  HuntSettings,
  HuntTheme,
  RankingImpact,
  VariableValue,
} from '../engine/types'

export type RegistrationMode = 'self-serve' | 'organizer-assigned' | 'rostered'

export interface RunPolicy {
  mode: 'disabled' | 'capped' | 'unlimited' | 'practice-only'
  /** Required when mode is capped. The first run counts toward this limit. */
  maxOfficialRuns?: number
}

export interface LeaderboardPolicy {
  bestRunRule: 'score_then_time_then_completion'
  mainBoardEnabled: boolean
  replayBoardEnabled: boolean
  replayBoardPublic: boolean
  timeVisibility: 'never' | 'after_second_eligible_run' | 'always'
  showProgress: boolean
}

export interface PublicBoardSettings {
  enabled: boolean
  slug?: string
  title?: string
  coverUrl?: string
  status: 'live' | 'frozen' | 'final'
  teamIdentity: 'code_only' | 'code_and_name'
  columns: Array<'rank' | 'team_code' | 'team_name' | 'points' | 'progress' | 'completion_status' | 'runs' | 'time'>
}

export interface SocialShareSettings {
  enabled: boolean
  organizerHandle?: string
  campaignHashtag?: string
  allowPersonalTitle: boolean
}

export interface RecognitionSettings {
  enabled: boolean
  peerVotingEnabled: boolean
  votingWindowMinutes: number
  dataWeight: number
  peerWeight: number
  titleLibrary?: Partial<Record<ContributionCategory, string>>
}

export type VariableGenerator =
  | { type: 'literal'; value: VariableValue }
  | { type: 'choice'; values: VariableValue[] }
  | { type: 'integer'; minimum: number; maximum: number; step?: number }
  | { type: 'code'; alphabet: string; length: number }

export interface RouteTransition {
  from: string
  to: string
}

export interface CheckpointEstimate {
  durationMinutes?: number
  difficulty?: 1 | 2 | 3 | 4 | 5
}

export interface TravelEstimate extends RouteTransition {
  durationMinutes?: number
  distanceMeters?: number
  bidirectional?: boolean
}

/**
 * Route IDs describe physical locations. A location without a challenge pool
 * uses a checkpoint with the same ID. A pooled location resolves to exactly
 * one of the pool's checkpoint variants for the run.
 */
export interface RoutePlanDefinition {
  startCheckpointId: string
  finaleCheckpointId: string
  requiredCheckpointIds: string[]
  choose: { count: number; fromCheckpointIds: string[] }
  shuffleSelectedCheckpoints?: boolean
  avoidTransitions?: RouteTransition[]
  checkpointEstimates: Record<string, CheckpointEstimate>
  travelEstimates: TravelEstimate[]
}

export interface ChallengeVariant {
  id: string
  checkpointId: string
  estimatedDurationMinutes?: number
  difficulty?: 1 | 2 | 3 | 4 | 5
  /** Optional author assertion. Publication validation checks it against the engine definition. */
  scoreCeiling?: number
  weight?: number
}

export interface ChallengePool {
  id: string
  variants: ChallengeVariant[]
}

export interface FairnessPolicy {
  /** Minimum number of meaningfully distinct route/challenge plans required before publication. */
  minimumDistinctPlans: number
  durationToleranceMinutes: number
  maxResolvedRoutes: number
  requireTravelEstimates: boolean
  walkingSpeedMetersPerMinute: number
  minutesPerDifficultyPoint: number
}

export type ParallelLane =
  | { id: string; label: string; type: 'qr'; token: string }
  | { id: string; label: string; type: 'code'; code: string; caseSensitive?: boolean }
  | { id: string; label: string; type: 'gps'; location: GPSRegion }
  | { id: string; label: string; type: 'photo'; location?: GPSRegion }

export interface ParallelMechanic {
  id: string
  checkpointId: string
  /** Must identify a verify_organizer gate in the reusable engine flow. */
  nodeId: string
  timeWindowSeconds: number
  lanes: ParallelLane[]
}

export interface PublicParallelMechanic {
  id: string
  checkpointId: string
  nodeId: string
  timeWindowSeconds: number
  lanes: Array<Pick<ParallelLane, 'id' | 'label' | 'type'>>
}

/** Existing runtime settings retained so a V3 run can reuse the V2 engine. */
export type RuntimeCompatibleSettings = Pick<HuntSettings,
  'map' | 'rules' | 'maxTeamSize' | 'minTeamSize' |
  'sessionDurationSeconds' | 'registrationOpen' | 'startsAt' | 'endsAt' |
  'completionMessage' | 'photoRetention'
> & {
  /** V3 routePlan owns progression order; open/dependency modes are not supported. */
  mode?: 'sequential'
}

export interface V3Settings extends RuntimeCompatibleSettings {
  registrationMode: RegistrationMode
  runPolicy: RunPolicy
  leaderboardPolicy: LeaderboardPolicy
  publicBoard: PublicBoardSettings
  socialShare: SocialShareSettings
  recognition: RecognitionSettings
  routePlan: RoutePlanDefinition
  challengePools: Record<string, ChallengePool>
  variableGenerators: Record<string, VariableGenerator>
  fairnessPolicy: FairnessPolicy
  parallelMechanics?: ParallelMechanic[]
}

/**
 * V3 owns orchestration around a run while deliberately retaining the existing
 * checkpoint/action shapes. The server materializes the selected checkpoints
 * into the immutable definition pinned to a run.
 */
export interface V3Definition {
  schemaVersion: 3
  id: string
  version: number
  title: string
  description?: string
  theme?: HuntTheme
  checkpoints: CheckpointDefinition[]
  dudQrs?: { token: string; message: string; points?: number; rankingImpact?: RankingImpact }[]
  settings: V3Settings
}

export interface ResolvedChallenge {
  routeCheckpointId: string
  poolId?: string
  variantId?: string
  checkpointId: string
}

export interface ResolvedRunPlan {
  /** Physical route order. Does not contain the private seed. */
  routeCheckpointIds: string[]
  /** Engine checkpoint IDs after challenge-pool selection. */
  checkpointIds: string[]
  challenges: ResolvedChallenge[]
  variables: Record<string, VariableValue>
}

export interface FairnessRouteResult {
  routeKey: string
  routeCheckpointIds: string[]
  checkpointIds: string[]
  challengeVariantIds: string[]
  maximumScore: number
  estimatedDurationMinutes: number
}

export type FairnessIssueCode =
  | 'invalid_route_plan'
  | 'route_limit_exceeded'
  | 'no_eligible_routes'
  | 'unreachable_route_choice'
  | 'unknown_checkpoint'
  | 'invalid_checkpoint_graph'
  | 'empty_challenge_pool'
  | 'variant_score_mismatch'
  | 'unequal_variant_scores'
  | 'duplicate_resolved_checkpoint'
  | 'unequal_random_branch_scores'
  | 'unmodeled_internal_variation'
  | 'competitive_fallback_not_allowed'
  | 'unequal_variant_weights'
  | 'insufficient_route_variation'
  | 'unsafe_duration_tiebreak'
  | 'gps_requires_companion_evidence'
  | 'qr_requires_companion_evidence'
  | 'shareable_verifier_requires_companion_evidence'
  | 'non_neutral_competitive_bonus'
  | 'score_cache_limit_exceeded'
  | 'unbounded_score_cache'
  | 'missing_duration_estimate'
  | 'missing_travel_estimate'
  | 'unequal_route_scores'
  | 'route_duration_out_of_tolerance'

export interface FairnessIssue {
  code: FairnessIssueCode
  path: string
  message: string
  routeKeys?: string[]
}

export interface FairnessReport {
  valid: boolean
  evaluatedRouteCount: number
  maximumScore?: number
  minimumDurationMinutes?: number
  maximumDurationMinutes?: number
  routes: FairnessRouteResult[]
  issues: FairnessIssue[]
}

export interface CompletedRunRecord {
  runId: string
  teamId: string
  teamCode: string
  teamName?: string
  attemptNumber: number
  status: 'waiting' | 'active' | 'completed' | 'abandoned' | 'disqualified'
  eligible: boolean
  practice?: boolean
  score: number
  elapsedMilliseconds: number
  completedAt?: string
  progress?: { completed: number; total: number }
}

export interface BestRunSelection {
  teamId: string
  teamCode: string
  teamName?: string
  bestRun: CompletedRunRecord
  firstRun: CompletedRunRecord
  eligibleCompletedRuns: number
}

export interface MainLeaderboardEntry {
  rank: number
  teamId: string
  teamCode: string
  teamName?: string
  score: number
  /** Absent until the team has an official or in-progress eligible run. */
  bestRunId?: string
  /** Absent for a registered team that has not started an eligible run. */
  bestAttemptNumber?: number
  eligibleCompletedRuns: number
  /** Eligible non-practice attempts represented by this live row. */
  runCount: number
  /** Live boards distinguish an official result from an in-progress placeholder. */
  status: 'registered' | 'waiting' | 'active' | 'completed'
  provisional: boolean
  progress?: { completed: number; total: number }
  visibleElapsedMilliseconds?: number
}

export interface ReplayLeaderboardEntry extends MainLeaderboardEntry {
  runCount: number
  bestElapsedMilliseconds: number
  scoreImprovementFromFirst: number
  timeImprovementFromFirstMilliseconds: number
}

export type ContributionCategory =
  | 'trailblazer'
  | 'puzzle_ace'
  | 'codebreaker'
  | 'eagle_eye'
  | 'clutch_player'
  | 'team_spark'

export interface TeamMemberIdentity {
  teamMemberId: string
  displayName: string
}

export interface ContributionEvent {
  id: string
  runId: string
  teamMemberId: string
  category: ContributionCategory
  credit: number
  evidence: string
  occurredAt: string
  verified: boolean
}

export type PeerRecognitionCategory = 'puzzle_power' | 'trail_speed' | 'clue_craft' | 'crew_energy'
export type PeerRecognitionSubtype =
  | 'word_hunter' | 'pattern_breaker' | 'number_wizard'
  | 'first_finder' | 'swift_scout' | 'qr_sprinter'
  | 'detail_detective' | 'logic_linker' | 'riddle_reader'
  | 'calm_captain' | 'momentum_maker' | 'helping_hand'

export interface RecognitionVote {
  id: string
  runId: string
  voterMemberId: string
  recipientMemberId: string
  category: PeerRecognitionCategory
  subtype: PeerRecognitionSubtype
  answerPath: string[]
  revision: number
  createdAt: string
  updatedAt: string
}

export interface RecognitionOverride {
  id: string
  teamMemberId: string
  title: string
  reason: string
  organizerId: string
  createdAt: string
}

export interface ContributionStanding {
  teamMemberId: string
  displayName: string
  rank: number
  totalCredit: number
  categoryCredits: Record<ContributionCategory, number>
  evidenceCount: number
}

export interface RecognitionResult {
  teamMemberId: string
  displayName: string
  blendedTitle: string
  calculatedTitle: string
  dataAchievement: {
    category: ContributionCategory
    label: string
    credit: number
    evidenceCount: number
    evidenceSummary: string[]
  }
  peerRecognition?: {
    category: PeerRecognitionCategory
    subtype: PeerRecognitionSubtype
    label: string
    votes: number
    explanation: string
  }
  override?: RecognitionOverride
}

export const PEER_RECOGNITION_SUBTYPES: Readonly<Record<PeerRecognitionCategory, readonly PeerRecognitionSubtype[]>> = {
  puzzle_power: ['word_hunter', 'pattern_breaker', 'number_wizard'],
  trail_speed: ['first_finder', 'swift_scout', 'qr_sprinter'],
  clue_craft: ['detail_detective', 'logic_linker', 'riddle_reader'],
  crew_energy: ['calm_captain', 'momentum_maker', 'helping_hand'],
}
