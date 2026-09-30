import {
  EngineError, type CheckpointDefinition, type CheckpointProgress, type CommandResult, type Condition,
  type DisplayContent, type Feedback, type GameCommand, type GameEvent, type GameState,
  type HintDefinition, type HuntDefinition, type InteractiveNode, type FlowNode, type NodeProgress, type OrganizerControl, type OrganizerOverride,
  type PlayerHint, type PlayerNode, type PlayerStageReview, type PlayerView, type PublicHintContent, type PuzzleProgress, type ScoreEntry,
} from './types'
import { initialPuzzleState, publicPuzzle, puzzleHintItems, puzzleHintItemSolved, updatePuzzle, PuzzleError, type PuzzleDefinition, type PuzzleReward, type PuzzleState } from './puzzles'
import { parseCommand, parseControl, validateHunt } from './validation'
import { assertSessionPlayable, elapsedMilliseconds, timerRemaining } from './session'

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
function timestamp(now: string): string {
  if (typeof now !== 'string' || !Number.isFinite(Date.parse(now))) throw new EngineError('invalid_time', 'The server clock is unavailable.')
  return new Date(now).toISOString()
}
function assertDefinition(definition: HuntDefinition): void {
  const issues = validateHunt(definition)
  if (issues.length) throw new EngineError('invalid_definition', issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'))
}
function assertState(definition: HuntDefinition, state: GameState): void {
  if (state.schemaVersion !== 1 || state.definitionId !== definition.id || state.definitionVersion !== definition.version) throw new EngineError('version_mismatch', 'This session belongs to a different published hunt version.')
  if (state.score !== state.ledger.reduce((sum, entry) => sum + entry.amount, 0) || new Set(state.ledger.map(entry => entry.id)).size !== state.ledger.length) throw new EngineError('invalid_state', 'The saved score needs organizer attention.')
  for (const checkpoint of definition.checkpoints) if (!state.checkpoints[checkpoint.id]) throw new EngineError('invalid_state', 'The saved progress needs organizer attention.')
}
function event(state: GameState, value: Omit<GameEvent, 'id'>): void { state.events.push({ id: `event-${state.events.length + 1}`, ...value }) }
function score(state: GameState, entry: Omit<ScoreEntry, 'id'>, semanticId?: string): void {
  const base = semanticId ?? `score-${state.ledger.length + 1}`
  let id = base, generation = 1
  while (state.ledger.some(item => item.id === id)) id = `${base}:${++generation}`
  state.ledger.push({ id, ...entry }); state.score += entry.amount
}
function isSettled(progress: CheckpointProgress): boolean { return progress.status === 'completed' || progress.status === 'skipped' }
function refreshAvailability(definition: HuntDefinition, state: GameState): void {
  for (const [index, checkpoint] of definition.checkpoints.entries()) {
    const progress = state.checkpoints[checkpoint.id]
    if (isSettled(progress) || progress.status === 'active') continue
    const dependencies = (checkpoint.prerequisites ?? []).every(id => isSettled(state.checkpoints[id]))
    const sequential = (definition.settings?.mode ?? 'sequential') !== 'sequential' || definition.checkpoints.slice(0, index).filter(cp => cp.required !== false).every(cp => isSettled(state.checkpoints[cp.id]))
    progress.status = dependencies && sequential ? 'available' : 'locked'
  }
}
function initialProgress(checkpoint: CheckpointDefinition): CheckpointProgress {
  return { status: 'locked', activeNodeId: null, nodes: Object.fromEntries(checkpoint.flow.nodes.map(node => [node.id, { status: 'pending', attempts: 0 }])) }
}
function newPuzzle(definition: PuzzleDefinition, revision = 0): PuzzleProgress { return { revision, state: initialPuzzleState(definition), completed: false } }
function requiredDone(definition: HuntDefinition, state: GameState): boolean { return definition.checkpoints.filter(cp => cp.required !== false).every(cp => isSettled(state.checkpoints[cp.id])) }
function afterCheckpoint(definition: HuntDefinition, state: GameState, now: string, budget: { remaining: number }): void {
  state.activeCheckpointId = null
  refreshAvailability(definition, state)
  if (requiredDone(definition, state)) {
    state.status = 'completed'
    if (!state.completedAt) { state.completedAt = now; event(state, { type: 'hunt_completed', at: now }) }
    return
  }
  state.status = 'active'
  const next = definition.checkpoints.find(cp => ['available', 'active'].includes(state.checkpoints[cp.id].status))
  if (next) activateCheckpoint(definition, state, next, now, budget)
}
function activateCheckpoint(definition: HuntDefinition, state: GameState, checkpoint: CheckpointDefinition, now: string, budget: { remaining: number }): void {
  const progress = state.checkpoints[checkpoint.id]
  if (!['active', 'available'].includes(progress.status)) throw new EngineError('checkpoint_locked', 'That checkpoint is not available yet.')
  // Selection precedes traversal, which can immediately complete this checkpoint
  // and select another. Resuming unfinished work must be recorded too.
  if (progress.status === 'active' && progress.activeNodeId) event(state, { type: 'checkpoint_selected', checkpointId: checkpoint.id, at: now })
  state.activeCheckpointId = checkpoint.id; state.status = 'active'
  if (progress.status === 'active' && progress.activeNodeId) return
  progress.status = 'active'; progress.startedAt ??= now
  event(state, { type: 'checkpoint_started', checkpointId: checkpoint.id, at: now })
  activateNode(definition, state, checkpoint, checkpoint.flow.startNodeId, now, budget)
}
function conditionMatches(condition: Condition, state: GameState, now: string): boolean {
  switch (condition.type) {
    case 'variable': return state.variables?.[condition.key] === condition.equals
    case 'checkpoint_completed': return state.checkpoints[condition.checkpointId].status === 'completed'
    case 'hint_used': return !!state.hintUsage[condition.hintId]
    case 'time': { const time = now.slice(11, 16); return condition.after <= condition.before ? time >= condition.after && time < condition.before : time >= condition.after || time < condition.before }
  }
}
function seededChoice(teamId: string, checkpointId: string, nodeId: string): number {
  let hash = 2166136261
  for (const char of `${teamId}:${checkpointId}:${nodeId}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return (hash >>> 0) / 4294967296
}
/** Older grids can prove a solve but cannot prove its original timestamp. */
function knownPuzzleDiscoveries(node: FlowNode, progress: NodeProgress): NonNullable<NodeProgress['puzzleDiscoveries']> {
  const recorded = copy(progress.puzzleDiscoveries ?? []), known = new Set(recorded.map(item => item.itemId))
  if (node.type === 'puzzle') for (const item of puzzleHintItems(node.puzzle)) {
    if (!known.has(item.id) && puzzleHintItemSolved(node.puzzle, progress.puzzle?.state, item.id)) recorded.push({ itemId: item.id })
  }
  return recorded
}
function activateNode(definition: HuntDefinition, state: GameState, checkpoint: CheckpointDefinition, nodeId: string, now: string, budget = { remaining: 20001 }): void {
  let nextNodeId = nodeId
  for (;;) {
  if (--budget.remaining < 0) throw new EngineError('invalid_definition', 'This route contains too many automatic steps. Contact the organizer.')
  const node = checkpoint.flow.nodes.find(candidate => candidate.id === nextNodeId)
  if (!node) throw new EngineError('invalid_definition', 'The next task is missing. Contact the organizer.')
  const progress = state.checkpoints[checkpoint.id], nodeProgress = progress.nodes[node.id]
  if (nodeProgress.status !== 'pending' && nodeProgress.status !== 'skipped') throw new EngineError('invalid_state', 'This action has already been reached.')
  progress.activeNodeId = node.id; nodeProgress.status = 'active'; nodeProgress.startedAt ??= now
  if (node.type === 'puzzle') nodeProgress.puzzle ??= newPuzzle(node.puzzle)
  if (node.type === 'complete') {
    nodeProgress.status = 'completed'; nodeProgress.completedAt = now; progress.status = 'completed'; progress.activeNodeId = null; progress.completedAt = now
    for (const candidate of Object.values(progress.nodes)) if (candidate.status === 'pending') candidate.status = 'skipped'
    score(state, { kind: 'checkpoint_completed', checkpointId: checkpoint.id, amount: checkpoint.basePoints, at: now }, `completion:${checkpoint.id}`)
    if (checkpoint.timeBonus && elapsedMilliseconds(state, progress.startedAt!, now) <= checkpoint.timeBonus.withinSeconds * 1000) score(state, { kind: 'time_bonus', checkpointId: checkpoint.id, amount: checkpoint.timeBonus.points, at: now }, `time:${checkpoint.id}`)
    event(state, { type: 'checkpoint_completed', checkpointId: checkpoint.id, nodeId: node.id, at: now })
    afterCheckpoint(definition, state, now, budget); return
  }
  let next: string | undefined
  if (node.type === 'set_variable') { state.variables ??= {}; state.variables[node.key] = node.value; next = node.next }
  if (node.type === 'add_points') {
    // Resetting an earlier action cannot farm automatic bonuses. A full checkpoint
    // restart explicitly compensates these awards before allowing a fresh award.
    const awarded = state.ledger.some(item => item.kind === 'action_points' && item.checkpointId === checkpoint.id && item.nodeId === node.id && !state.ledger.some(refund => refund.reverses === item.id))
    if (!awarded) { score(state, { kind: 'action_points', checkpointId: checkpoint.id, nodeId: node.id, amount: node.amount, at: now, reason: node.label }); event(state, { type: 'points_changed', checkpointId: checkpoint.id, nodeId: node.id, at: now, amount: node.amount, reason: node.label }) }
    next = node.next
  }
  if (node.type === 'branch') next = conditionMatches(node.condition, state, now) ? node.ifTrue : node.ifFalse
  if (node.type === 'random_branch') {
    const assigned = state.routeAssignments?.find(item => item.checkpointId === checkpoint.id && item.nodeId === node.id)
    if (assigned) {
      if (node.choices[assigned.choiceIndex]?.next !== assigned.nextNodeId) throw new EngineError('invalid_state', 'This route assignment needs organizer attention.')
      next = assigned.nextNodeId
    } else {
      if (definition.settings?.assignmentVersion === 2) throw new EngineError('invalid_state', 'This team has no saved route assignment. Contact the organizer.')
      let position = seededChoice(state.teamId, checkpoint.id, node.id) * node.choices.reduce((sum, item) => sum + item.weight, 0)
      next = node.choices.at(-1)!.next
      for (const choice of node.choices) { position -= choice.weight; if (position < 0) { next = choice.next; break } }
    }
  }
  if (!next) return
  nodeProgress.status = 'completed'; nodeProgress.completedAt = now; nextNodeId = next
  }
}
export function createInitialState(definition: HuntDefinition, teamId: string, now: string, options: { waiting?: boolean; routeAssignments?: GameState['routeAssignments'] } = {}): GameState {
  assertDefinition(definition)
  if (typeof teamId !== 'string' || !teamId.trim() || teamId.length > 200) throw new EngineError('invalid_team', 'A team is required.')
  const at = timestamp(now)
  const state: GameState = { schemaVersion: 1, definitionId: definition.id, definitionVersion: definition.version, teamId, revision: 0, status: 'active', activeCheckpointId: null, checkpoints: {}, hintUsage: {}, ledger: [], events: [], score: 0, variables: {}, fallbacks: {}, startedAt: at }
  for (const checkpoint of definition.checkpoints) state.checkpoints[checkpoint.id] = initialProgress(checkpoint)
  if (options.routeAssignments) state.routeAssignments = copy(options.routeAssignments)
  if (options.waiting) { state.status = 'waiting'; delete state.startedAt; return state }
  if (definition.settings?.sessionDurationSeconds) state.timer = { durationSeconds: definition.settings.sessionDurationSeconds, deadlineAt: new Date(Date.parse(at) + definition.settings.sessionDurationSeconds * 1000).toISOString(), pauses: [], extensions: [] }
  refreshAvailability(definition, state)
  const first = definition.checkpoints.find(cp => state.checkpoints[cp.id].status === 'available')
  if (!first) throw new EngineError('invalid_definition', 'This hunt has no available starting checkpoint.')
  activateCheckpoint(definition, state, first, at, { remaining: 20001 })
  return state
}
function currentAction(definition: HuntDefinition, state: GameState, checkpointId: string, nodeId: string): { checkpoint: CheckpointDefinition; node: InteractiveNode } {
  if (state.activeCheckpointId !== checkpointId) throw new EngineError('stale_action', 'Your team has moved on. Refresh to see the current task.')
  const checkpoint = definition.checkpoints.find(candidate => candidate.id === checkpointId), progress = state.checkpoints[checkpointId]
  if (!checkpoint || progress.status !== 'active' || progress.activeNodeId !== nodeId) throw new EngineError('stale_action', 'Your team has moved on. Refresh to see the current task.')
  const node = checkpoint.flow.nodes.find(candidate => candidate.id === nodeId)
  if (!node || !Object.hasOwn(actionRegistry, node.type) || progress.nodes[nodeId]?.status !== 'active') throw new EngineError('invalid_state', 'This task needs organizer attention.')
  return { checkpoint, node: node as InteractiveNode }
}
function normalize(value: string, caseSensitive = false): string { const text = value.normalize('NFKC').trim().replace(/\s+/g, ' '); return caseSensitive ? text : text.toLowerCase() }
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const h = Math.sin(radians(bLat - aLat) / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(radians(bLng - aLng) / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)))
}
interface Context { definition: HuntDefinition; state: GameState; checkpoint: CheckpointDefinition; now: string }
interface ActionOutcome { accepted: boolean; next?: string; message: string; dud?: boolean; audit?: GameEvent['type']; attempt?: boolean; response?: string }
interface ActionModule { commands: GameCommand['type'][]; execute: (node: InteractiveNode, command: GameCommand, context: Context) => ActionOutcome; toPlayer: (node: InteractiveNode, context: Context) => PlayerNode }
function action<T extends InteractiveNode['type']>(type: T, implementation: { commands: GameCommand['type'][]; execute: (node: Extract<InteractiveNode, { type: T }>, command: GameCommand, context: Context) => ActionOutcome; toPlayer: (node: Extract<InteractiveNode, { type: T }>, context: Context) => PlayerNode }): ActionModule {
  return { commands: implementation.commands, execute(node, command, context) { if (node.type !== type) return invalidAction(); return implementation.execute(node as Extract<InteractiveNode, { type: T }>, command, context) }, toPlayer(node, context) { if (node.type !== type) return invalidAction(); const player = implementation.toPlayer(node as Extract<InteractiveNode, { type: T }>, context); return node.clue ? { ...player, clue: node.clue } : player } }
}
const invalidAction = (): never => { throw new EngineError('invalid_action', 'That action is not available for the current task.') }
function puzzleUpdate(definition: PuzzleDefinition, progress: PuzzleProgress, command: { expectedRevision: number; value: unknown }, submit: boolean): { progress: PuzzleProgress; rewards: PuzzleReward[]; message?: string } {
  if (command.expectedRevision !== progress.revision) throw new EngineError('puzzle_conflict', 'A teammate updated this puzzle. Refresh to see their work before making another move.')
  try { const result = updatePuzzle(definition, progress.state, command.value); return { progress: { revision: progress.revision + 1, state: result.state, completed: submit && result.completed }, rewards: result.rewards ?? [], ...(result.message ? { message: result.message } : {}) } }
  catch (error) { if (error instanceof PuzzleError) throw new EngineError(error.code, error.message); throw error }
}
function applyPuzzleRewards(state: GameState, checkpointId: string, now: string, rewards: PuzzleReward[], identity: { nodeId?: string; hintId?: string }): void {
  for (const reward of rewards) {
    const owner = identity.nodeId ?? `hint:${identity.hintId}`
    const semanticId = `puzzle:${checkpointId}:${owner}:${reward.id}`
    const activeAward = state.ledger.some(entry => (entry.id === semanticId || entry.id.startsWith(`${semanticId}:`)) && !state.ledger.some(refund => refund.reverses === entry.id))
    if (activeAward) continue
    score(state, { kind: reward.kind ?? 'action_points', checkpointId, ...identity, amount: reward.amount, at: now, reason: reward.label }, semanticId)
    event(state, { type: 'points_changed', checkpointId, ...identity, amount: reward.amount, at: now, reason: reward.label })
  }
}
function puzzleResponse(definition: PuzzleDefinition, state: PuzzleState): string {
  if (definition.type !== state.type) return 'Puzzle completed'
  switch (state.type) {
    case 'jigsaw': return 'Frankie picture completed'
    case 'sudoku': return 'Sudoku completed'
    case 'word_search': return state.foundWords.join(', ')
    case 'crossword': return 'Crossword completed'
    case 'rotation': return 'Picture aligned'
    case 'text': return 'Answer solved'
    case 'multiple_choice': return definition.type === 'multiple_choice' ? definition.options.find(option => option.id === state.optionId)?.label ?? 'Choice completed' : 'Choice completed'
    case 'quiz': return `Quiz completed with ${state.correctCount} correct answers`
    case 'matching': return `${state.pairs.length} pairs matched`
    case 'sequence': return definition.type === 'sequence' ? state.order.map(id => definition.items.find(item => item.id === id)?.label ?? id).join(' ') : 'Sequence completed'
  }
}
/** The registry owns interactive verification/projection; generic traversal is unchanged by puzzle adapters. */
export const actionRegistry: Readonly<Record<InteractiveNode['type'], ActionModule>> = Object.freeze({
  show_text: action('show_text', { commands: ['continue'], execute: node => ({ accepted: true, next: node.next, message: 'Continue to your next task.' }), toPlayer: node => ({ id: node.id, type: node.type, text: node.text }) }),
  show_media: action('show_media', { commands: ['continue'], execute: node => ({ accepted: true, next: node.next, message: 'Your next task is ready.' }), toPlayer: node => ({ id: node.id, type: node.type, content: publicDisplay(node.content) }) }),
  camera_guide: action('camera_guide', { commands: ['continue'], execute: node => ({ accepted: true, next: node.next, message: 'Continue when you are ready.' }), toPlayer: node => ({ id: node.id, type: node.type, prompt: node.prompt, ...(node.referenceImageUrl ? { referenceImageUrl: node.referenceImageUrl } : {}), ...(node.latitude !== undefined ? { latitude: node.latitude, longitude: node.longitude } : {}) }) }),
  verify_qr: action('verify_qr', {
    commands: ['verify'], execute(node, command, context) {
      if (command.type !== 'verify') return invalidAction()
      const accepted = command.value === node.token || (node.backupCode !== undefined && normalize(command.value) === normalize(node.backupCode))
      if (accepted) return { accepted: true, next: node.next, message: 'You found it!', attempt: true, response: command.value === node.token ? 'QR scanned' : 'Printed phrase accepted' }
      const index = context.definition.dudQrs?.findIndex(dud => dud.token === command.value) ?? -1, dud = context.definition.dudQrs?.[index]
      if (dud?.points && !context.state.ledger.some(entry => entry.id === `dud:${index}`)) score(context.state, { kind: 'dud_discovery', checkpointId: context.checkpoint.id, amount: dud.points, at: context.now, reason: dud.message }, `dud:${index}`)
      return { accepted: false, dud: !!dud, message: dud?.message ?? 'That is not the code for this task. Keep looking and try again.', attempt: true }
    }, toPlayer: node => ({ id: node.id, type: node.type, prompt: node.prompt, backupCodeEnabled: node.backupCode !== undefined }),
  }),
  verify_code: action('verify_code', {
    commands: ['verify'], execute(node, command) { if (command.type !== 'verify') return invalidAction(); const accepted = normalize(command.value, node.caseSensitive) === normalize(node.code, node.caseSensitive); return { accepted, next: accepted ? node.next : undefined, message: accepted ? 'Code accepted!' : 'That code does not match. Check it and try again.', attempt: true, ...(accepted ? { response: node.recapAnswer ?? 'Code accepted' } : {}) } }, toPlayer: node => ({ id: node.id, type: node.type, prompt: node.prompt }),
  }),
  verify_answer: action('verify_answer', {
    commands: ['verify'], execute(node, command) { if (command.type !== 'verify') return invalidAction(); const accepted = node.answers.some(answer => normalize(command.value, node.caseSensitive) === normalize(answer, node.caseSensitive)); return { accepted, next: accepted ? node.next : undefined, message: accepted ? 'Correct answer!' : 'Not quite. Give it another try.', attempt: true, ...(accepted ? { response: node.recapAnswer ?? 'Answer accepted' } : {}) } }, toPlayer: node => ({ id: node.id, type: node.type, prompt: node.prompt }),
  }),
  verify_gps: action('verify_gps', {
    commands: ['verify_gps'], execute(node, command) {
      if (command.type !== 'verify_gps') return invalidAction()
      if (command.location.accuracyMeters > node.maxAccuracyMeters) return { accepted: false, message: 'Your location reading is too uncertain. Move into an open area, try again, or ask the organizer for help.', attempt: true }
      const accepted = distanceMeters(node.latitude, node.longitude, command.location.latitude, command.location.longitude) <= node.radiusMeters
      return { accepted, next: accepted ? node.next : undefined, message: accepted ? 'You appear to be in the right area!' : 'You do not appear to be in the search area yet. Get closer and try again.', attempt: true, ...(accepted ? { response: 'Location confirmed' } : {}) }
    }, toPlayer: node => ({ id: node.id, type: node.type, prompt: node.prompt }),
  }),
  choose_path: action('choose_path', {
    commands: ['choose_path'], execute(node, command) { if (command.type !== 'choose_path') return invalidAction(); const selected = node.choices.find(item => item.id === command.choiceId); if (!selected) return invalidAction(); return { accepted: true, next: selected.next, message: 'Your next task is ready.', response: selected.label } }, toPlayer: node => ({ id: node.id, type: node.type, prompt: node.prompt, choices: node.choices.map(({ id, label }) => ({ id, label })) }),
  }),
  puzzle: action('puzzle', {
    commands: ['save_puzzle', 'submit_puzzle'], execute(node, command, context) {
      if (command.type !== 'save_puzzle' && command.type !== 'submit_puzzle') return invalidAction()
      const saved = context.state.checkpoints[context.checkpoint.id].nodes[node.id]
      const previous = saved.puzzle ?? newPuzzle(node.puzzle)
      const retained = knownPuzzleDiscoveries(node, saved)
      const update = puzzleUpdate(node.puzzle, previous, command, command.type === 'submit_puzzle')
      saved.puzzle = update.progress
      const recorded = new Set(retained.map(item => item.itemId))
      const discoveries = puzzleHintItems(node.puzzle).filter(item => !recorded.has(item.id) && puzzleHintItemSolved(node.puzzle, saved.puzzle?.state, item.id))
      if (retained.length || discoveries.length) saved.puzzleDiscoveries = [...retained, ...discoveries.map(item => ({ itemId: item.id, solvedAt: context.now }))]
      applyPuzzleRewards(context.state, context.checkpoint.id, context.now, update.rewards, { nodeId: node.id })
      const bonus = update.rewards.reduce((sum, reward) => sum + reward.amount, 0)
      return { accepted: true, next: saved.puzzle.completed ? node.next : undefined, message: saved.puzzle.completed ? 'Puzzle solved!' : update.message ?? (bonus ? `Ingredient found — +${bonus} bonus points!` : 'Your puzzle progress is saved. Keep going.'), audit: saved.puzzle.completed ? 'puzzle_completed' : 'puzzle_saved', ...(saved.puzzle.completed ? { response: puzzleResponse(node.puzzle, saved.puzzle.state) } : {}) }
    }, toPlayer: (node, context) => ({ id: node.id, type: node.type, prompt: node.prompt, puzzle: publicPuzzle(node.puzzle), progress: copy(context.state.checkpoints[context.checkpoint.id].nodes[node.id].puzzle ?? newPuzzle(node.puzzle)) }),
  }),
  verify_organizer: action('verify_organizer', { commands: [], execute: () => invalidAction(), toPlayer: node => ({ id: node.id, type: node.type, prompt: node.prompt }) }),
  verify_image: action('verify_image', {
    commands: ['submit_photo'], execute(node, command, context) {
      if (command.type !== 'submit_photo') return invalidAction()
      // The server adapter checks upload ownership, checkpoint binding and any
      // configured GPS evidence before it invokes this trusted transition.
      const progress = context.state.checkpoints[context.checkpoint.id].nodes[node.id]
      if (progress.photoStatus === 'pending') throw new EngineError('review_pending', 'Your photo is already waiting for organizer review.')
      progress.pendingPhotoId = command.mediaId; progress.photoStatus = 'pending'; delete progress.reviewMessage
      return { accepted: true, message: 'Photo sent. The organizer will verify it shortly. Your progress is saved.', audit: 'photo_submitted' }
    }, toPlayer(node, context) { const p = context.state.checkpoints[context.checkpoint.id].nodes[node.id]; return { id: node.id, type: node.type, prompt: node.prompt, locationRequired: !!node.location, ...(p.photoStatus ? { photoStatus: p.photoStatus } : {}), ...(p.reviewMessage ? { reviewMessage: p.reviewMessage } : {}) } },
  }),
})
function targetSolved(hint: HintDefinition, state: GameState, checkpoint: CheckpointDefinition): boolean {
  if (!hint.relevance) return false
  const node = checkpoint.flow.nodes.find(n => n.id === hint.relevance!.nodeId), progress = state.checkpoints[checkpoint.id].nodes[hint.relevance.nodeId]
  if (!node || !progress) return false
  if (progress.firstSolvedAt || progress.status === 'completed') return true
  return node.type === 'puzzle' && !!hint.relevance.puzzleItemId && (!!progress.puzzleDiscoveries?.some(item => item.itemId === hint.relevance!.puzzleItemId) || puzzleHintItemSolved(node.puzzle, progress.puzzle?.state, hint.relevance.puzzleItemId))
}
function hintAvailability(hint: HintDefinition, state: GameState, checkpoint: CheckpointDefinition, now: string): { status: PlayerHint['status']; reason?: string } {
  if (state.hintUsage[hint.id]) return { status: 'used' }
  if (hint.enabled === false) return { status: 'locked', reason: 'This hint is disabled.' }
  if (state.activeCheckpointId !== checkpoint.id || state.checkpoints[checkpoint.id].status !== 'active') return { status: 'locked', reason: 'This hint is available during its checkpoint.' }
  if (hint.relevance) {
    const node = checkpoint.flow.nodes.find(candidate => candidate.id === hint.relevance!.nodeId)
    const progress = state.checkpoints[checkpoint.id].nodes[hint.relevance.nodeId]
    if (!node || !progress) return { status: 'locked', reason: 'This hint needs organizer attention.' }
    if (!progress.startedAt) return { status: 'locked', reason: 'Available when your team reaches the related step.' }
    const solved = targetSolved(hint, state, checkpoint) || progress.status === 'skipped'
    if (solved && hint.relevance.expireWhenSolved !== false) return { status: 'expired', reason: 'Your team has already solved what this hint helps with. No points were charged.' }
    const attemptsRemaining = (hint.relevance.unlockAfterAttempts ?? 0) - progress.attempts
    if (attemptsRemaining > 0) return { status: 'locked', reason: `Available after ${attemptsRemaining} more ${attemptsRemaining === 1 ? 'try' : 'tries'} on this step.` }
    const targetSecondsRemaining = (hint.relevance.unlockAfterSeconds ?? 0) - elapsedMilliseconds(state, progress.startedAt, now) / 1000
    if (targetSecondsRemaining > 0) return { status: 'locked', reason: `Available in ${Math.ceil(targetSecondsRemaining)} seconds on this step.` }
  }
  if (hint.availability?.afterHintIds?.some(id => {
    const prerequisite = checkpoint.hints.find(item => item.id === id)
    return !state.hintUsage[id] && !(prerequisite?.enabled !== false && prerequisite?.relevance?.expireWhenSolved !== false && prerequisite && targetSolved(prerequisite, state, checkpoint))
  })) return { status: 'locked', reason: 'Use the required hints, or solve their targets, first.' }
  if (hint.availability?.afterNodeId && state.checkpoints[checkpoint.id].nodes[hint.availability.afterNodeId].status !== 'completed') return { status: 'locked', reason: 'Continue the current task to unlock this hint.' }
  const remaining = (hint.availability?.afterSeconds ?? 0) - elapsedMilliseconds(state, state.checkpoints[checkpoint.id].startedAt!, now) / 1000
  return remaining > 0 ? { status: 'locked', reason: `Available in ${Math.ceil(remaining)} seconds.` } : { status: 'available' }
}
function purchaseHint(definition: HuntDefinition, original: GameState, command: Extract<GameCommand, { type: 'use_hint' }>, now: string): CommandResult {
  const checkpoint = definition.checkpoints.find(cp => cp.id === command.checkpointId), hint = checkpoint?.hints.find(item => item.id === command.hintId)
  if (!checkpoint || !hint) throw new EngineError('invalid_hint', 'That hint is not available for this checkpoint.')
  if (original.hintUsage[hint.id]) return { state: original, feedback: { status: 'already_applied', message: 'Your team already has this hint. You were not charged again.', scannerShouldStop: false } }
  if (original.activeCheckpointId !== checkpoint.id) throw new EngineError('stale_action', 'Your team has moved on. Refresh to see the current task.')
  const availability = hintAvailability(hint, original, checkpoint, now)
  if (availability.status !== 'available') throw new EngineError('hint_locked', availability.reason ?? 'That hint is not available yet.')
  const state = copy(original)
  state.hintUsage[hint.id] = { hintId: hint.id, checkpointId: checkpoint.id, usedAt: now, cost: hint.cost, ...(hint.content.type === 'puzzle' ? { puzzle: newPuzzle(hint.content.puzzle, state.hintPuzzleRevisions?.[hint.id] ?? 0) } : {}) }
  score(state, { kind: 'hint_used', checkpointId: checkpoint.id, hintId: hint.id, amount: -hint.cost, at: now }, `hint:${hint.id}`)
  state.revision++; event(state, { type: 'hint_used', checkpointId: checkpoint.id, hintId: hint.id, at: now })
  return { state, feedback: { status: 'accepted', message: hint.content.type === 'puzzle' ? 'Solve this puzzle to reveal your hint.' : hint.cost ? `Hint revealed (${hint.cost} points).` : 'Hint revealed.', scannerShouldStop: false } }
}
function advance(definition: HuntDefinition, state: GameState, checkpoint: CheckpointDefinition, node: InteractiveNode, next: string, now: string, skipped = false): void {
  const progress = state.checkpoints[checkpoint.id].nodes[node.id]
  progress.status = skipped ? 'skipped' : 'completed'; progress.completedAt = now
  if (!skipped) progress.firstSolvedAt ??= now
  event(state, { type: 'action_completed', checkpointId: checkpoint.id, nodeId: node.id, at: now })
  activateNode(definition, state, checkpoint, next, now)
}
const feedback = (message: string, scannerShouldStop = false): Feedback => ({ status: 'accepted', message, scannerShouldStop })
/** Caller authenticates, locks the team, resolves receipts, and persists this result atomically. */
export function executeCommand(definition: HuntDefinition, original: GameState, input: GameCommand, now: string): CommandResult {
  assertDefinition(definition); assertState(definition, original)
  const command = parseCommand(input), at = timestamp(now)
  if (command.type === 'update_roster') throw new EngineError('invalid_command', 'Roster changes require the authenticated server boundary.')
  if (command.type === 'start_session') {
    if (original.status !== 'waiting') return { state: original, feedback: { status: 'already_applied', message: 'Your team has already started. The timer has not restarted.', scannerShouldStop: false } }
    if (command.expectedRevision !== original.revision) throw new EngineError('stale_roster', 'The roster changed. Refresh before starting.')
    const state = createInitialState(definition, original.teamId, at, { routeAssignments: original.routeAssignments })
    state.events = [...copy(original.events), ...state.events].map((entry, index) => ({ ...entry, id: `event-${index + 1}` }))
    state.revision = original.revision + 1
    state.startingRoster = copy(original.startingRoster ?? [])
    if (original.resultReview) state.resultReview = copy(original.resultReview)
    event(state, { type: 'session_started', at })
    return { state, feedback: feedback('Your team has started. Good luck!') }
  }
  // Schedules/event status are checked by the server; the engine owns its own timer.
  if (original.status === 'waiting' || original.timer) assertSessionPlayable({ ...definition, settings: { ...definition.settings, startsAt: undefined, endsAt: undefined } }, original, 'live', at)
  if (command.type === 'use_hint') return purchaseHint(definition, original, command, at)
  const state = copy(original)
  if (command.type === 'choose_checkpoint') {
    refreshAvailability(definition, state)
    const checkpoint = definition.checkpoints.find(cp => cp.id === command.checkpointId)
    if (!checkpoint) throw new EngineError('checkpoint_locked', 'That checkpoint is unavailable.')
    if (state.activeCheckpointId === checkpoint.id) return { state: original, feedback: { status: 'already_applied', message: 'Your team is already here.', scannerShouldStop: false } }
    activateCheckpoint(definition, state, checkpoint, at, { remaining: 20001 }); state.revision++
    return { state, feedback: feedback('Your selected checkpoint is ready.') }
  }
  if (command.type === 'save_hint_puzzle' || command.type === 'submit_hint_puzzle') {
    const checkpoint = definition.checkpoints.find(cp => cp.id === command.checkpointId), hint = checkpoint?.hints.find(item => item.id === command.hintId), usage = state.hintUsage[command.hintId]
    if (!checkpoint || !hint || hint.content.type !== 'puzzle' || !usage?.puzzle || state.activeCheckpointId !== checkpoint.id) throw new EngineError('invalid_hint', 'Open the purchased puzzle hint at its checkpoint before playing.')
    if (usage.puzzle.completed) return { state: original, feedback: { status: 'already_applied', message: 'Your team has already solved this hint.', scannerShouldStop: false } }
    const update = puzzleUpdate(hint.content.puzzle, usage.puzzle, command, command.type === 'submit_hint_puzzle')
    usage.puzzle = update.progress
    applyPuzzleRewards(state, checkpoint.id, at, update.rewards, { hintId: hint.id })
    state.revision++
    event(state, { type: usage.puzzle.completed ? 'puzzle_completed' : 'puzzle_saved', checkpointId: checkpoint.id, hintId: hint.id, at })
    return { state, feedback: feedback(usage.puzzle.completed ? 'Puzzle solved. Your hint is revealed.' : 'Your puzzle progress is saved. Keep going.') }
  }
  // All remaining commands address the team's current interactive action.
  if (!('nodeId' in command)) return invalidAction()
  const { checkpoint, node } = currentAction(definition, state, command.checkpointId, command.nodeId)
  if (command.type === 'use_fallback') {
    if (!node.fallback || !(state.fallbacks?.[`${checkpoint.id}:${node.id}`] ?? node.fallback.enabled)) throw new EngineError('fallback_unavailable', 'That recovery option is not enabled. Ask the organizer for help.')
    event(state, { type: 'fallback_used', checkpointId: checkpoint.id, nodeId: node.id, at }); state.revision++
    state.checkpoints[checkpoint.id].nodes[node.id].publicResponse = 'Used the recovery route'
    advance(definition, state, checkpoint, node, node.fallback.nodeId, at, true)
    return { state, feedback: feedback('Your alternative task is ready.', node.type === 'verify_qr') }
  }
  const actionModule = actionRegistry[node.type]
  if (!actionModule.commands.includes(command.type)) return invalidAction()
  const outcome = actionModule.execute(node, command, { definition, state, checkpoint, now: at })
  state.revision++
  if (outcome.attempt) state.checkpoints[checkpoint.id].nodes[node.id].attempts++
  if (node.type === 'verify_answer' && node.recordAnswerAttempts === true && command.type === 'verify') {
    const progress = state.checkpoints[checkpoint.id].nodes[node.id]
    const limit = 500
    progress.answerAttempts = [...(progress.answerAttempts ?? []), {
      submittedAt: at,
      value: command.value.slice(0, limit),
      accepted: outcome.accepted,
      ...(command.value.length > limit ? { truncated: true } : {}),
    }].slice(-20)
  }
  if (outcome.audit) event(state, { type: outcome.audit, checkpointId: checkpoint.id, nodeId: node.id, at })
  if (outcome.accepted && outcome.response) state.checkpoints[checkpoint.id].nodes[node.id].publicResponse = outcome.response
  if (outcome.accepted && outcome.next) advance(definition, state, checkpoint, node, outcome.next, at)
  else if (!outcome.accepted) {
    event(state, { type: outcome.dud ? 'dud_qr_scanned' : 'verification_failed', checkpointId: checkpoint.id, nodeId: node.id, at })
    // Sensor inaccuracy and deliberate decoys do not incur wrong-answer penalties.
    if (!outcome.dud && checkpoint.wrongAttemptPenalty && ['verify_answer', 'verify_code', 'verify_qr'].includes(node.type)) score(state, { kind: 'wrong_attempt', checkpointId: checkpoint.id, nodeId: node.id, amount: -checkpoint.wrongAttemptPenalty, at })
  }
  return { state, feedback: { status: outcome.accepted ? 'accepted' : outcome.dud ? 'dud' : 'rejected', message: outcome.message, scannerShouldStop: outcome.accepted && !!outcome.next && node.type === 'verify_qr' } }
}
/** Only authenticated organizer APIs may call this. Exact revision prevents stale interventions. */
export function executeControl(definition: HuntDefinition, original: GameState, input: OrganizerControl, now: string): CommandResult {
  assertDefinition(definition); assertState(definition, original)
  const control = parseControl(input), at = timestamp(now)
  if (control.expectedRevision !== original.revision) throw new EngineError('stale_control', 'This team has changed since you opened it. Refresh before applying an organizer action.')
  const state = copy(original)
  const checkpoint = control.checkpointId ? definition.checkpoints.find(cp => cp.id === control.checkpointId) : undefined
  if (control.checkpointId && !checkpoint) throw new EngineError('invalid_override', 'The selected checkpoint does not exist.')
  const reason = control.reason
  event(state, { type: 'organizer_override', checkpointId: checkpoint?.id, ...('nodeId' in control ? { nodeId: control.nodeId } : {}), ...('hintId' in control ? { hintId: control.hintId } : {}), reason: `${control.type}: ${reason}`, at })
  state.revision++
  if (control.type === 'extend_session') {
    if (!state.timer || !state.startedAt) throw new EngineError('invalid_override', 'Only a started timed team can receive extra time.')
    const previousDeadline = state.timer.deadlineAt, pausedAt = state.timer.pauses.find(p => !p.endedAt)?.startedAt
    const base = Math.max(Date.parse(previousDeadline), Date.parse(pausedAt ?? at))
    state.timer.deadlineAt = new Date(base + control.seconds * 1000).toISOString()
    state.timer.extensions.push({ at, seconds: control.seconds, previousDeadline, deadlineAt: state.timer.deadlineAt, reason })
    event(state, { type: 'session_extended', at, amount: control.seconds, reason })
    return { state, feedback: feedback('The organizer granted additional time.') }
  }
  if (control.type === 'correct_roster' || control.type === 'review_result') throw new EngineError('invalid_override', 'Use the authenticated organizer server boundary for this action.')
  if (state.status === 'waiting') throw new EngineError('session_waiting', 'Start the team before changing its gameplay.')
  if (control.type === 'adjust_score') {
    score(state, { kind: 'organizer_adjustment', checkpointId: checkpoint?.id ?? '', amount: control.amount, reason, at }); event(state, { type: 'points_changed', checkpointId: checkpoint?.id, amount: control.amount, reason, at })
    return { state, feedback: feedback('The organizer updated your score.') }
  }
  if (!checkpoint) throw new EngineError('invalid_override', 'Choose a checkpoint for this action.')
  const progress = state.checkpoints[checkpoint.id]
  if (control.type === 'reset_hint') {
    const usage = state.hintUsage[control.hintId]
    if (!usage || usage.checkpointId !== checkpoint.id) throw new EngineError('invalid_override', 'That hint has not been used at this checkpoint.')
    const charge = [...state.ledger].reverse().find(entry => entry.kind === 'hint_used' && entry.hintId === control.hintId && !state.ledger.some(refund => refund.reverses === entry.id))
    if (charge) score(state, { kind: 'refund', checkpointId: checkpoint.id, hintId: control.hintId, amount: -charge.amount, reverses: charge.id, reason, at })
    for (const award of state.ledger.filter(entry => entry.kind === 'action_points' && entry.hintId === control.hintId && !state.ledger.some(refund => refund.reverses === entry.id))) score(state, { kind: 'refund', checkpointId: checkpoint.id, hintId: control.hintId, amount: -award.amount, reverses: award.id, reason, at })
    if (usage.puzzle) { state.hintPuzzleRevisions ??= {}; state.hintPuzzleRevisions[control.hintId] = usage.puzzle.revision + 1 }
    delete state.hintUsage[control.hintId]
    return { state, feedback: feedback('The organizer reset this hint and refunded its cost.') }
  }
  if (control.type === 'enable_fallback') {
    const node = checkpoint.flow.nodes.find(n => n.id === control.nodeId)
    if (!node || !('fallback' in node) || !node.fallback) throw new EngineError('invalid_override', 'Configure an alternative path before changing its availability.')
    state.fallbacks ??= {}; state.fallbacks[`${checkpoint.id}:${node.id}`] = control.enabled
    return { state, feedback: feedback(control.enabled ? 'The organizer enabled an alternative way to continue.' : 'The organizer disabled this alternative.') }
  }
  if (control.type === 'move_checkpoint') {
    // Reopening reverses earned completion/automatic bonuses but preserves hint
    // charges, wrong attempts and their complete audit history.
    if (isSettled(progress)) {
      for (const entry of [...state.ledger]) if (entry.checkpointId === checkpoint.id && ['checkpoint_completed', 'time_bonus', 'action_points', 'skip_penalty'].includes(entry.kind) && !state.ledger.some(refund => refund.reverses === entry.id)) score(state, { kind: 'refund', checkpointId: checkpoint.id, amount: -entry.amount, reverses: entry.id, reason, at })
      const nodeHistory = Object.fromEntries(Object.entries(progress.nodes).flatMap(([nodeId, nodeProgress]) => {
        const discoveries = knownPuzzleDiscoveries(checkpoint.flow.nodes.find(node => node.id === nodeId)!, nodeProgress)
        const history = {
          ...(nodeProgress.answerAttempts?.length ? { answerAttempts: copy(nodeProgress.answerAttempts) } : {}),
          ...(discoveries.length ? { puzzleDiscoveries: discoveries } : {}),
          ...((nodeProgress.firstSolvedAt ?? (nodeProgress.status === 'completed' ? nodeProgress.completedAt : undefined)) ? { firstSolvedAt: nodeProgress.firstSolvedAt ?? nodeProgress.completedAt } : {}),
        }
        return Object.keys(history).length ? [[nodeId, history]] : []
      }))
      state.checkpoints[checkpoint.id] = initialProgress(checkpoint)
      for (const [nodeId, history] of Object.entries(nodeHistory)) Object.assign(state.checkpoints[checkpoint.id].nodes[nodeId], history)
      for (const node of checkpoint.flow.nodes) if (node.type === 'puzzle' && progress.nodes[node.id].puzzle) state.checkpoints[checkpoint.id].nodes[node.id].puzzle = newPuzzle(node.puzzle, progress.nodes[node.id].puzzle!.revision + 1)
      if (checkpoint.required !== false) delete state.completedAt
    }
    state.checkpoints[checkpoint.id].status = state.checkpoints[checkpoint.id].activeNodeId ? 'active' : 'available'
    activateCheckpoint(definition, state, checkpoint, at, { remaining: 20001 })
    return { state, feedback: feedback('The organizer moved your team to this checkpoint.') }
  }
  if (control.type === 'skip_checkpoint') {
    if (state.activeCheckpointId !== checkpoint.id || progress.status !== 'active') throw new EngineError('stale_action', 'Select the team’s current checkpoint before skipping it.')
    progress.status = 'skipped'; progress.completedAt = at; progress.activeNodeId = null
    for (const node of Object.values(progress.nodes)) if (node.status === 'active' || node.status === 'pending') node.status = 'skipped'
    if (checkpoint.skipPenalty) score(state, { kind: 'skip_penalty', checkpointId: checkpoint.id, amount: -checkpoint.skipPenalty, reason, at })
    event(state, { type: 'checkpoint_skipped', checkpointId: checkpoint.id, reason, at }); afterCheckpoint(definition, state, at, { remaining: 20001 })
    return { state, feedback: feedback('The organizer skipped this checkpoint. Your next task is ready.') }
  }
  if (!('nodeId' in control)) throw new EngineError('invalid_override', 'Choose an action for this intervention.')
  const { node } = currentAction(definition, state, checkpoint.id, control.nodeId)
  const nodeProgress = progress.nodes[node.id]
  if (control.type === 'reset_action') {
    const puzzleRevision = (nodeProgress.puzzle?.revision ?? -1) + 1
    progress.nodes[node.id] = { status: 'active', attempts: 0, startedAt: at, ...((nodeProgress.firstSolvedAt ?? (nodeProgress.status === 'completed' ? nodeProgress.completedAt : undefined)) ? { firstSolvedAt: nodeProgress.firstSolvedAt ?? nodeProgress.completedAt } : {}), ...(nodeProgress.answerAttempts?.length ? { answerAttempts: copy(nodeProgress.answerAttempts) } : {}), ...(knownPuzzleDiscoveries(node, nodeProgress).length ? { puzzleDiscoveries: knownPuzzleDiscoveries(node, nodeProgress) } : {}), ...(node.type === 'puzzle' ? { puzzle: newPuzzle(node.puzzle, puzzleRevision) } : {}) }
    return { state, feedback: feedback('The organizer reset this task. Try again.') }
  }
  if (control.type === 'reject_photo') {
    if (node.type !== 'verify_image' || nodeProgress.photoStatus !== 'pending') throw new EngineError('invalid_override', 'There is no pending photo to review.')
    nodeProgress.photoStatus = 'rejected'; nodeProgress.reviewMessage = reason; delete nodeProgress.pendingPhotoId
    event(state, { type: 'photo_rejected', checkpointId: checkpoint.id, nodeId: node.id, reason, at })
    return { state, feedback: feedback(`Please try another photo. ${reason}`) }
  }
  if (node.type === 'choose_path') throw new EngineError('invalid_override', 'A path choice cannot be approved directly. Enable a fallback or move the team instead.')
  if (node.type === 'verify_image' && nodeProgress.photoStatus === 'pending') nodeProgress.photoStatus = 'approved'
  nodeProgress.publicResponse = control.type === 'skip_action' ? 'Skipped by organizer' : node.type === 'verify_image' ? 'Photo approved' : 'Approved by organizer'
  advance(definition, state, checkpoint, node, node.next, at, control.type === 'skip_action')
  return { state, feedback: feedback(control.type === 'skip_action' ? 'The organizer skipped this task.' : 'The organizer approved this task. Your next task is ready.', node.type === 'verify_qr') }
}
/** Compatibility for the original approval route; it still checks the expected action. */
export function executeOverride(definition: HuntDefinition, original: GameState, override: OrganizerOverride, now: string): CommandResult {
  const result = executeControl(definition, original, { type: 'approve_action', ...override, expectedRevision: original.revision }, now)
  // Keep the original route's reason contract for existing audit consumers.
  const entry = [...result.state.events].reverse().find(item => item.type === 'organizer_override')
  if (entry) entry.reason = override.reason.trim()
  return result
}
function publicDisplay(content: DisplayContent): DisplayContent {
  switch (content.type) {
    case 'text': return { type: content.type, text: content.text }
    case 'image': return { type: content.type, url: content.url, alt: content.alt }
    case 'map': return { type: content.type, latitude: content.latitude, longitude: content.longitude, radiusMeters: content.radiusMeters }
    case 'audio': case 'video': return { type: content.type, url: content.url, title: content.title, ...(content.transcript ? { transcript: content.transcript } : {}) }
    case 'camera': return { type: content.type, description: content.description, ...(content.referenceImageUrl ? { referenceImageUrl: content.referenceImageUrl } : {}), ...(content.latitude !== undefined ? { latitude: content.latitude, longitude: content.longitude } : {}) }
  }
}
function publicHint(hint: HintDefinition, state: GameState): PublicHintContent {
  if (hint.content.type !== 'puzzle') return publicDisplay(hint.content)
  const progress = state.hintUsage[hint.id].puzzle ?? newPuzzle(hint.content.puzzle)
  return { type: 'puzzle', puzzle: publicPuzzle(hint.content.puzzle), progress: copy(progress), ...(progress.completed ? { reveal: publicDisplay(hint.content.reveal) } : {}) }
}
function reviewText(node: InteractiveNode): string {
  if (node.type === 'show_text') return node.text
  if ('prompt' in node) return node.prompt
  switch (node.content.type) {
    case 'text': return node.content.text
    case 'image': return node.content.alt
    case 'audio': case 'video': return node.content.title
    case 'map': return 'Map clue'
    case 'camera': return node.content.description
  }
}
function playerStages(definition: HuntDefinition, state: GameState): PlayerStageReview[] {
  return definition.checkpoints.flatMap(checkpoint => {
    const checkpointProgress = state.checkpoints[checkpoint.id]
    if (!checkpointProgress.startedAt || checkpointProgress.status === 'locked' || checkpointProgress.status === 'available') return []
    const steps = checkpoint.flow.nodes.flatMap(node => {
      const nodeProgress = checkpointProgress.nodes[node.id]
      if (!nodeProgress?.startedAt || !Object.hasOwn(actionRegistry, node.type)) return []
      const interactive = node as InteractiveNode
      const response = nodeProgress.publicResponse ?? (interactive.type === 'puzzle' && nodeProgress.puzzle?.completed ? puzzleResponse(interactive.puzzle, nodeProgress.puzzle.state) : undefined)
      return [{ id: interactive.id, text: reviewText(interactive), ...(response ? { response } : {}) }]
    })
    return [{ id: checkpoint.id, title: checkpoint.title, status: checkpointProgress.status as PlayerStageReview['status'], steps, hints: checkpoint.hints.filter(hint => state.hintUsage[hint.id]).map(hint => ({ id: hint.id, title: hint.title, type: hint.content.type, cost: state.hintUsage[hint.id].cost, status: 'used' as const, content: publicHint(hint, state) })) }]
  })
}
/** Allowlist projection; definitions, private answers, unpublished hints and media references never spread into player APIs. */
export function getPlayerView(definition: HuntDefinition, state: GameState, now: string): PlayerView {
  assertDefinition(definition); assertState(definition, state)
  const at = timestamp(now), checkpoint = definition.checkpoints.find(cp => cp.id === state.activeCheckpointId)
  const required = definition.checkpoints.filter(cp => cp.required !== false)
  const startedAt = state.startedAt ?? Object.values(state.checkpoints).find(cp => cp.startedAt)?.startedAt ?? at
  const settings = definition.settings ? copy(definition.settings) : undefined
  if (settings) delete settings.assignmentVersion
  if (settings && !state.completedAt) delete settings.completionMessage
  const visibleTitle = (checkpoint: CheckpointDefinition, index: number) => state.checkpoints[checkpoint.id].status === 'locked' ? `Stage ${index + 1}` : checkpoint.title
  const view: PlayerView = {
    hunt: { id: definition.id, title: definition.title, ...(definition.description !== undefined ? { description: definition.description } : {}), ...(settings ? { settings } : {}), ...(definition.theme ? { theme: copy(definition.theme) } : {}) },
    teamId: state.teamId, revision: state.revision, status: state.status, score: state.score, serverNow: at,
    ...(state.timer ? { timer: { deadlineAt: state.timer.deadlineAt, durationSeconds: state.timer.durationSeconds, remainingSeconds: timerRemaining(state, at)!, paused: state.timer.pauses.some(p => !p.endedAt) } } : {}),
    progress: { completed: Object.values(state.checkpoints).filter(cp => cp.status === 'completed').length, total: definition.checkpoints.length, requiredCompleted: required.filter(cp => isSettled(state.checkpoints[cp.id])).length, requiredTotal: required.length },
    checkpoint: null, node: null, hints: [],
    checkpoints: definition.checkpoints.map((cp, index) => ({ id: cp.id, title: visibleTitle(cp, index), status: state.checkpoints[cp.id].status, required: cp.required !== false, ...(cp.group ? { group: cp.group } : {}), ...(cp.location && (definition.settings?.map === 'all' || (definition.settings?.map === 'visited' && state.checkpoints[cp.id].startedAt)) ? { location: copy(cp.location) } : {}) })),
    stages: playerStages(definition, state),
    summary: { startedAt, ...(state.completedAt ? { completedAt: state.completedAt } : {}), elapsedSeconds: Math.floor(elapsedMilliseconds(state, startedAt, state.completedAt ?? at) / 1000), hintsUsed: Object.keys(state.hintUsage).length, checkpoints: definition.checkpoints.map((cp, index) => ({ id: cp.id, title: visibleTitle(cp, index), status: state.checkpoints[cp.id].status, points: state.ledger.filter(entry => entry.checkpointId === cp.id).reduce((sum, entry) => sum + entry.amount, 0) })) },
  }
  if (state.status === 'waiting') { view.checkpoints = []; view.stages = []; delete view.summary; return view }
  if (!checkpoint) return view
  const progress = state.checkpoints[checkpoint.id], node = checkpoint.flow.nodes.find(candidate => candidate.id === progress.activeNodeId)
  if (!node || !Object.hasOwn(actionRegistry, node.type) || !progress.startedAt) throw new EngineError('invalid_state', 'This task needs organizer attention.')
  const interactive = node as InteractiveNode
  view.checkpoint = { id: checkpoint.id, title: checkpoint.title, basePoints: checkpoint.basePoints, startedAt: progress.startedAt }
  view.node = actionRegistry[interactive.type].toPlayer(interactive, { definition, state, checkpoint, now: at })
  if (interactive.fallback) view.node.fallback = { label: interactive.fallback.label, enabled: state.fallbacks?.[`${checkpoint.id}:${node.id}`] ?? interactive.fallback.enabled }
  view.hints = checkpoint.hints.flatMap(hint => {
    const availability = hintAvailability(hint, state, checkpoint, at)
    if (availability.status !== 'used' && (hint.enabled === false || (hint.relevance && !progress.nodes[hint.relevance.nodeId]?.startedAt) || availability.status === 'expired' || (availability.status === 'locked' && hint.showWhenLocked === false))) return []
    return [{ id: hint.id, title: hint.title, type: hint.content.type, cost: hint.cost, ...availability, ...(availability.status === 'used' ? { content: publicHint(hint, state) } : {}) }]
  })
  return view
}
