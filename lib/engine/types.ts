import type { PuzzleDefinition, PuzzlePublicDefinition, PuzzleState } from './puzzles/types'
export type { PuzzleDefinition, PuzzlePublicDefinition, PuzzleState } from './puzzles/types'

/** Published definitions are immutable and private to the server. */
export interface HuntDefinition {
  schemaVersion: 1
  id: string
  version: number
  title: string
  description?: string
  checkpoints: CheckpointDefinition[]
  dudQrs?: { token: string; message: string; points?: number }[]
  settings?: HuntSettings
  theme?: HuntTheme
}
export interface HuntSettings {
  mode?: 'sequential' | 'open' | 'dependency'
  leaderboard?: 'live' | 'hidden' | 'finish'
  ranking?: 'points' | 'progress' | 'points_time'
  map?: 'none' | 'all' | 'visited'
  rules?: string
  maxTeamSize?: number
  registrationOpen?: boolean
  startsAt?: string
  endsAt?: string
  completionMessage?: string
  photoRetention?: 'after_verification' | 'after_event' | 'retain'
}
export interface HuntTheme {
  primaryColor?: string
  logoUrl?: string
  coverUrl?: string
  backgroundUrl?: string
  font?: 'system' | 'serif'
  feedback?: boolean
  buttonShape?: 'rounded' | 'pill' | 'square'
  checkpointIconStyle?: 'numbers' | 'symbols' | 'none'
  successAnimation?: 'none' | 'pulse' | 'celebrate'
}
export interface MapLocation { latitude: number; longitude: number; radiusMeters: number }
export interface GPSRegion extends MapLocation { maxAccuracyMeters: number }
export interface CheckpointDefinition {
  id: string
  title: string
  basePoints: number
  required?: boolean
  prerequisites?: string[]
  group?: string
  location?: MapLocation
  wrongAttemptPenalty?: number
  skipPenalty?: number
  timeBonus?: { withinSeconds: number; points: number }
  flow: { startNodeId: string; nodes: FlowNode[] }
  hints: HintDefinition[]
}
export interface Fallback { nodeId: string; label: string; enabled: boolean }
export type VariableValue = string | number | boolean
export type Condition =
  | { type: 'variable'; key: string; equals: VariableValue }
  | { type: 'checkpoint_completed'; checkpointId: string }
  | { type: 'hint_used'; hintId: string }
  | { type: 'time'; after: string; before: string }
export type InteractiveNode = (
  | { id: string; type: 'show_text'; text: string; next: string }
  | { id: string; type: 'show_media'; content: DisplayContent; next: string }
  | { id: string; type: 'verify_qr'; prompt: string; token: string; backupCode?: string; next: string }
  | { id: string; type: 'verify_code'; prompt: string; code: string; caseSensitive?: boolean; next: string }
  | { id: string; type: 'verify_answer'; prompt: string; answers: string[]; caseSensitive?: boolean; next: string }
  | ({ id: string; type: 'verify_gps'; prompt: string; next: string } & GPSRegion)
  | { id: string; type: 'choose_path'; prompt: string; choices: { id: string; label: string; next: string }[] }
  | { id: string; type: 'puzzle'; prompt: string; puzzle: PuzzleDefinition; next: string }
  | { id: string; type: 'camera_guide'; prompt: string; referenceImageUrl?: string; latitude?: number; longitude?: number; next: string }
  | { id: string; type: 'verify_organizer'; prompt: string; next: string }
  | { id: string; type: 'verify_image'; prompt: string; referenceImages: string[]; location?: GPSRegion; next: string }
) & { fallback?: Fallback }
export type FlowNode = InteractiveNode
  | { id: string; type: 'set_variable'; key: string; value: VariableValue; next: string }
  | { id: string; type: 'branch'; condition: Condition; ifTrue: string; ifFalse: string }
  | { id: string; type: 'random_branch'; choices: { next: string; weight: number }[] }
  | { id: string; type: 'add_points'; amount: number; label: string; next: string }
  | { id: string; type: 'complete' }

export type DisplayContent =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; alt: string }
  | ({ type: 'map' } & MapLocation)
  | { type: 'audio' | 'video'; url: string; title: string; transcript?: string }
  | { type: 'camera'; referenceImageUrl?: string; description: string; latitude?: number; longitude?: number }
export type HintContent = DisplayContent | { type: 'puzzle'; puzzle: PuzzleDefinition; reveal: DisplayContent }
export interface HintDefinition {
  id: string
  title: string
  cost: number
  content: HintContent
  availability?: { afterHintIds?: string[]; afterSeconds?: number; afterNodeId?: string }
}
export interface PuzzleProgress { revision: number; state: PuzzleState; completed: boolean }
export type PublicHintContent = DisplayContent | { type: 'puzzle'; puzzle: PuzzlePublicDefinition; progress: PuzzleProgress; reveal?: DisplayContent }
export type GameCommand =
  | { type: 'continue'; checkpointId: string; nodeId: string }
  | { type: 'verify'; checkpointId: string; nodeId: string; value: string }
  | { type: 'verify_gps'; checkpointId: string; nodeId: string; location: { latitude: number; longitude: number; accuracyMeters: number } }
  | { type: 'choose_path'; checkpointId: string; nodeId: string; choiceId: string }
  | { type: 'use_hint'; checkpointId: string; hintId: string }
  | { type: 'choose_checkpoint'; checkpointId: string }
  | { type: 'use_fallback'; checkpointId: string; nodeId: string }
  | { type: 'save_puzzle' | 'submit_puzzle'; checkpointId: string; nodeId: string; expectedRevision: number; value: unknown }
  | { type: 'save_hint_puzzle' | 'submit_hint_puzzle'; checkpointId: string; hintId: string; expectedRevision: number; value: unknown }
  | { type: 'submit_photo'; checkpointId: string; nodeId: string; mediaId: string }

export interface OrganizerOverride { checkpointId: string; nodeId: string; reason: string }
interface ControlBase { expectedRevision: number; reason: string }
export type OrganizerControl = ControlBase & (
  | { type: 'approve_action' | 'skip_action' | 'reset_action' | 'reject_photo'; checkpointId: string; nodeId: string }
  | { type: 'skip_checkpoint' | 'move_checkpoint'; checkpointId: string }
  | { type: 'adjust_score'; amount: number; checkpointId?: string }
  | { type: 'reset_hint'; checkpointId: string; hintId: string }
  | { type: 'enable_fallback'; checkpointId: string; nodeId: string; enabled: boolean }
)
export interface NodeProgress {
  status: 'pending' | 'active' | 'completed' | 'skipped'
  attempts: number
  startedAt?: string
  completedAt?: string
  puzzle?: PuzzleProgress
  pendingPhotoId?: string
  photoStatus?: 'pending' | 'rejected' | 'approved'
  reviewMessage?: string
}
export interface CheckpointProgress {
  status: 'locked' | 'available' | 'active' | 'completed' | 'skipped'
  activeNodeId: string | null
  startedAt?: string
  completedAt?: string
  nodes: Record<string, NodeProgress>
}
export interface HintUsage {
  hintId: string
  checkpointId: string
  usedAt: string
  cost: number
  puzzle?: PuzzleProgress
}
export interface ScoreEntry {
  id: string
  kind: 'checkpoint_completed' | 'hint_used' | 'wrong_attempt' | 'skip_penalty' | 'time_bonus' | 'action_points' | 'organizer_adjustment' | 'refund' | 'dud_discovery'
  checkpointId: string
  nodeId?: string
  hintId?: string
  amount: number
  at: string
  reason?: string
  reverses?: string
}
export interface GameEvent {
  id: string
  type: 'checkpoint_started' | 'action_completed' | 'verification_failed' | 'dud_qr_scanned' | 'hint_used' | 'checkpoint_completed' | 'hunt_completed' | 'organizer_override' | 'checkpoint_selected' | 'checkpoint_skipped' | 'puzzle_saved' | 'puzzle_completed' | 'photo_submitted' | 'photo_rejected' | 'fallback_used' | 'points_changed'
  at: string
  checkpointId?: string
  nodeId?: string
  hintId?: string
  reason?: string
  amount?: number
}
/** Persist this aggregate atomically with command receipts. New optional fields allow old saves to load. */
export interface GameState {
  schemaVersion: 1
  definitionId: string
  definitionVersion: number
  teamId: string
  revision: number
  status: 'active' | 'completed'
  activeCheckpointId: string | null
  checkpoints: Record<string, CheckpointProgress>
  hintUsage: Record<string, HintUsage>
  ledger: ScoreEntry[]
  events: GameEvent[]
  score: number
  variables?: Record<string, VariableValue>
  fallbacks?: Record<string, boolean>
  hintPuzzleRevisions?: Record<string, number>
  startedAt?: string
  completedAt?: string
}
export type PlayerNode = (
  | { id: string; type: 'show_text'; text: string }
  | { id: string; type: 'show_media'; content: DisplayContent }
  | { id: string; type: 'verify_qr'; prompt: string; backupCodeEnabled: boolean }
  | { id: string; type: 'verify_code' | 'verify_answer' | 'verify_gps' | 'verify_organizer'; prompt: string }
  | { id: string; type: 'choose_path'; prompt: string; choices: { id: string; label: string }[] }
  | { id: string; type: 'puzzle'; prompt: string; puzzle: PuzzlePublicDefinition; progress: PuzzleProgress }
  | { id: string; type: 'camera_guide'; prompt: string; referenceImageUrl?: string; latitude?: number; longitude?: number }
  | { id: string; type: 'verify_image'; prompt: string; photoStatus?: NodeProgress['photoStatus']; reviewMessage?: string; locationRequired: boolean }
) & { fallback?: { label: string; enabled: boolean } }
export interface PlayerHint {
  id: string
  title: string
  type: HintContent['type']
  cost: number
  status: 'available' | 'locked' | 'used'
  reason?: string
  content?: PublicHintContent
}
export interface PlayerCheckpoint {
  id: string
  title: string
  status: CheckpointProgress['status']
  required: boolean
  group?: string
  location?: MapLocation
}
export interface PlayerView {
  hunt: { id: string; title: string; description?: string; settings?: HuntSettings; theme?: HuntTheme }
  teamId: string
  revision: number
  status: 'active' | 'completed'
  score: number
  progress: { completed: number; total: number; requiredCompleted?: number; requiredTotal?: number }
  checkpoint: { id: string; title: string; basePoints: number; startedAt: string } | null
  node: PlayerNode | null
  hints: PlayerHint[]
  checkpoints?: PlayerCheckpoint[]
  summary?: { startedAt: string; completedAt?: string; elapsedSeconds: number; hintsUsed: number; checkpoints: { id: string; title: string; status: CheckpointProgress['status']; points: number }[] }
}
export interface Feedback { status: 'accepted' | 'rejected' | 'dud' | 'already_applied'; message: string; scannerShouldStop: boolean }
export interface CommandResult { state: GameState; feedback: Feedback }
export interface ValidationIssue { path: string; message: string }
export class EngineError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'EngineError' }
}
