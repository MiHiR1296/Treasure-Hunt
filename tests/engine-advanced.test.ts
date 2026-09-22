import test from 'node:test'
import assert from 'node:assert/strict'
import { createInitialState, EngineError, executeCommand, executeControl, getPlayerView, parseCommand, parseControl, validateHunt, type CheckpointDefinition, type FlowNode, type GameState, type HuntDefinition } from '../lib/engine'

const now = '2026-09-17T10:00:00.000Z'
const later = '2026-09-17T10:01:00.000Z'
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const code = (expected: string) => (error: unknown) => error instanceof EngineError && error.code === expected
const cp = (id: string, nodes: FlowNode[] = [{ id: 'answer', type: 'verify_answer', prompt: 'Name the landmark', answers: ['gate'], next: 'done' }, { id: 'done', type: 'complete' }]): CheckpointDefinition => ({ id, title: id, basePoints: 20, flow: { startNodeId: nodes[0].id, nodes }, hints: [] })
const hunt = (checkpoints = [cp('first')]): HuntDefinition => ({ schemaVersion: 1, id: 'advanced', version: 1, title: 'Advanced adventure', checkpoints })
const solve = (h: HuntDefinition, state: GameState, checkpointId: string, at = now) => executeCommand(h, state, { type: 'verify', checkpointId, nodeId: 'answer', value: 'gate' }, at).state

function puzzleHunt(): HuntDefinition {
  return hunt([cp('first', [{ id: 'puzzle', type: 'puzzle', prompt: 'Order the colors', puzzle: { type: 'sequence', items: [{ id: 'a', label: 'red' }, { id: 'b', label: 'green' }, { id: 'c', label: 'blue' }], solution: ['b', 'a', 'c'] }, next: 'done' }, { id: 'done', type: 'complete' }])])
}

const wordPath = (row: number) => ({ path: [0, 1, 2].map(column => ({ row, column })) })
function bonusWordSearchHunt(): HuntDefinition {
  return hunt([cp('first', [{ id: 'puzzle', type: 'puzzle', prompt: 'Find the animals', puzzle: { type: 'word_search', grid: [['C', 'A', 'T'], ['D', 'O', 'G'], ['O', 'W', 'L']], words: ['CAT', 'DOG', 'OWL'], minimumWords: 1, bonusPerExtraWord: 2 }, next: 'done' }, { id: 'done', type: 'complete' }])])
}

test('puzzle save is durable and private, stale teammate edits are rejected, submission advances once', () => {
  const h = puzzleHunt(), original = createInitialState(h, 'team', now)
  const initial = copy(original), publicView = getPlayerView(h, original, now)
  assert.equal(publicView.node?.type, 'puzzle')
  assert.equal(JSON.stringify(publicView).includes('solution'), false)
  let state = executeCommand(h, original, { type: 'save_puzzle', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: 0, value: { order: ['b', 'a', 'c'] } }, now).state
  assert.deepEqual(original, initial)
  assert.equal(state.status, 'active', 'saving a solution does not bypass deliberate submission')
  const refreshed = getPlayerView(h, copy(state), later).node
  assert.ok(refreshed?.type === 'puzzle'); assert.equal(refreshed.progress.revision, 1)
  assert.deepEqual(refreshed.progress.state, { type: 'sequence', order: ['b', 'a', 'c'] })
  assert.throws(() => executeCommand(h, state, { type: 'save_puzzle', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: 0, value: { order: ['a', 'b', 'c'] } }, now), code('puzzle_conflict'))
  state = executeCommand(h, state, { type: 'submit_puzzle', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: 1, value: { order: ['b', 'a', 'c'] } }, now).state
  assert.equal(state.status, 'completed'); assert.equal(state.score, 20)
  assert.throws(() => executeCommand(h, state, { type: 'submit_puzzle', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: 1, value: { order: ['b', 'a', 'c'] } }, now), code('stale_action'))
})

test('puzzle hints reuse the module, hide reward until solved, and preserve cost idempotency', () => {
  const h = hunt(); h.checkpoints[0].hints = [{ id: 'puzzle-hint', title: 'Solve a clue', cost: 4, content: { type: 'puzzle', puzzle: { type: 'text', prompt: 'Say north', answers: ['PRIVATE-ANSWER'] }, reveal: { type: 'text', text: 'PRIVATE-REWARD' } } }]
  let state = createInitialState(h, 'team', now)
  assert.equal(JSON.stringify(getPlayerView(h, state, now)).includes('PRIVATE'), false)
  state = executeCommand(h, state, { type: 'use_hint', checkpointId: 'first', hintId: 'puzzle-hint' }, now).state
  const purchased = JSON.stringify(getPlayerView(h, state, now))
  assert.equal(purchased.includes('PRIVATE-ANSWER'), false); assert.equal(purchased.includes('PRIVATE-REWARD'), false)
  state = executeCommand(h, state, { type: 'save_hint_puzzle', checkpointId: 'first', hintId: 'puzzle-hint', expectedRevision: 0, value: { value: 'PRIVATE-ANSWER' } }, now).state
  assert.equal(JSON.stringify(getPlayerView(h, state, now)).includes('PRIVATE-REWARD'), false)
  state = executeCommand(h, state, { type: 'submit_hint_puzzle', checkpointId: 'first', hintId: 'puzzle-hint', expectedRevision: 1, value: { value: 'PRIVATE-ANSWER' } }, now).state
  assert.equal(JSON.stringify(getPlayerView(h, state, now)).includes('PRIVATE-REWARD'), true)
  assert.equal(state.checkpoints.first.activeNodeId, 'answer'); assert.equal(state.score, -4)
  assert.equal(executeCommand(h, state, { type: 'use_hint', checkpointId: 'first', hintId: 'puzzle-hint' }, now).state.score, -4)
})

test('open-world task switching preserves unfinished puzzle progress and optional finish time', () => {
  const h = puzzleHunt(); h.settings = { mode: 'open' }; h.checkpoints.push({ ...cp('required'), required: true }, { ...cp('bonus'), required: false }); h.checkpoints[0].required = false
  let state = createInitialState(h, 'team', now)
  state = executeCommand(h, state, { type: 'save_puzzle', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: 0, value: { order: ['a', 'c', 'b'] } }, now).state
  state = executeCommand(h, state, { type: 'choose_checkpoint', checkpointId: 'required' }, now).state
  state = solve(h, state, 'required', later)
  assert.equal(state.status, 'completed'); assert.equal(state.completedAt, later)
  state = executeCommand(h, state, { type: 'choose_checkpoint', checkpointId: 'first' }, later).state
  assert.equal(state.status, 'active'); assert.equal(state.completedAt, later)
  assert.deepEqual(state.checkpoints.first.nodes.puzzle.puzzle?.state, { type: 'sequence', order: ['a', 'c', 'b'] })
  state = executeCommand(h, state, { type: 'submit_puzzle', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: 1, value: { order: ['b', 'a', 'c'] } }, '2026-09-17T10:03:00Z').state
  assert.equal(state.completedAt, later); assert.equal(state.status, 'completed'); assert.equal(state.score, 40)
})

test('dependency hub unlocks only after all prerequisites; optional steps do not lock sequential required tasks', () => {
  const h = hunt([cp('a'), cp('b'), { ...cp('hub'), prerequisites: ['a', 'b'] }]); h.settings = { mode: 'dependency' }
  let state = createInitialState(h, 'team', now)
  assert.equal(state.checkpoints.hub.status, 'locked')
  assert.throws(() => executeCommand(h, state, { type: 'choose_checkpoint', checkpointId: 'hub' }, now), code('checkpoint_locked'))
  state = solve(h, state, 'a'); assert.equal(state.checkpoints.hub.status, 'locked')
  state = solve(h, state, 'b'); assert.equal(state.activeCheckpointId, 'hub')
  state = solve(h, state, 'hub'); assert.equal(state.status, 'completed')
  const sequential = hunt([{ ...cp('bonus'), required: false }, cp('required')])
  let second = createInitialState(sequential, 'team', now)
  second = executeCommand(sequential, second, { type: 'choose_checkpoint', checkpointId: 'required' }, now).state
  assert.equal(solve(sequential, second, 'required').status, 'completed')
})

test('destroyed QR fallback is private, remotely enabled, revision guarded and follows the configured path', () => {
  const h = hunt([cp('first', [{ id: 'qr', type: 'verify_qr', prompt: 'Scan', token: 'PRIVATE-TOKEN', next: 'done', fallback: { nodeId: 'backup', label: 'Use recovery code', enabled: false } }, { id: 'backup', type: 'verify_code', prompt: 'Code', code: 'PRIVATE-BACKUP', next: 'done' }, { id: 'done', type: 'complete' }])])
  let state = createInitialState(h, 'team', now)
  assert.equal(JSON.stringify(getPlayerView(h, state, now)).includes('PRIVATE'), false)
  assert.throws(() => executeCommand(h, state, { type: 'use_fallback', checkpointId: 'first', nodeId: 'qr' }, now), code('fallback_unavailable'))
  state = executeControl(h, state, { type: 'enable_fallback', checkpointId: 'first', nodeId: 'qr', enabled: true, expectedRevision: 0, reason: 'Printed QR destroyed' }, now).state
  assert.throws(() => executeControl(h, state, { type: 'enable_fallback', checkpointId: 'first', nodeId: 'qr', enabled: false, expectedRevision: 0, reason: 'Stale panel' }, now), code('stale_control'))
  assert.equal(getPlayerView(h, state, now).node?.fallback?.enabled, true)
  state = executeCommand(h, state, { type: 'use_fallback', checkpointId: 'first', nodeId: 'qr' }, now).state
  assert.equal(state.checkpoints.first.nodes.qr.status, 'skipped')
  state = executeCommand(h, state, { type: 'verify', checkpointId: 'first', nodeId: 'backup', value: 'PRIVATE-BACKUP' }, now).state
  assert.equal(state.status, 'completed'); assert.equal(state.score, 20)
  assert.equal(h.checkpoints[0].flow.nodes[0].type === 'verify_qr' && h.checkpoints[0].flow.nodes[0].fallback?.enabled, false, 'published definition remains immutable')
})

test('score corrections, hint refunds and checkpoint restart preserve audit history and exact ledger sum', () => {
  const h = hunt(); h.checkpoints[0].wrongAttemptPenalty = 2; h.checkpoints[0].timeBonus = { withinSeconds: 90, points: 5 }; h.checkpoints[0].hints = [{ id: 'hint', title: 'Clue', cost: 4, content: { type: 'text', text: 'Look up' } }]
  let state = createInitialState(h, 'team', now)
  state = executeCommand(h, state, { type: 'use_hint', checkpointId: 'first', hintId: 'hint' }, now).state
  state = executeCommand(h, state, { type: 'verify', checkpointId: 'first', nodeId: 'answer', value: 'wrong' }, now).state
  assert.equal(state.score, -6)
  state = executeControl(h, state, { type: 'reset_hint', checkpointId: 'first', hintId: 'hint', expectedRevision: state.revision, reason: 'Organizer gave wrong clue' }, now).state
  assert.equal(state.score, -2); assert.equal(state.hintUsage.hint, undefined)
  state = executeCommand(h, state, { type: 'use_hint', checkpointId: 'first', hintId: 'hint' }, now).state
  state = solve(h, state, 'first', later); assert.equal(state.score, 19)
  const history = copy(state.ledger)
  state = executeControl(h, state, { type: 'move_checkpoint', checkpointId: 'first', expectedRevision: state.revision, reason: 'Replay after restoration' }, later).state
  assert.equal(state.score, -6); assert.equal(state.completedAt, undefined)
  assert.deepEqual(state.ledger.slice(0, history.length), history, 'earlier entries are never erased or changed')
  state = solve(h, state, 'first', later); assert.equal(state.score, 19)
  state = executeControl(h, state, { type: 'adjust_score', amount: 3, expectedRevision: state.revision, reason: 'Organizer correction' }, later).state
  assert.equal(state.score, 22); assert.equal(state.score, state.ledger.reduce((sum, entry) => sum + entry.amount, 0))
  assert.equal(new Set(state.ledger.map(entry => entry.id)).size, state.ledger.length)
})

test('checkpoint skip is explicit, deducts only configured penalty, and permits required hunt completion', () => {
  const h = hunt([cp('first'), cp('second')]); h.checkpoints[0].skipPenalty = 3
  let state = createInitialState(h, 'team', now)
  state = executeControl(h, state, { type: 'skip_checkpoint', checkpointId: 'first', expectedRevision: state.revision, reason: 'Unsafe route' }, now).state
  assert.equal(state.checkpoints.first.status, 'skipped'); assert.equal(state.score, -3); assert.equal(state.activeCheckpointId, 'second')
  state = solve(h, state, 'second'); assert.equal(state.status, 'completed'); assert.equal(state.score, 17)
  assert.equal(getPlayerView(h, state, now).progress.requiredCompleted, 2)
})

test('reset puzzle and reopening completed checkpoint never accept stale pre-reset saves', () => {
  const h = puzzleHunt(); let state = createInitialState(h, 'team', now)
  state = executeControl(h, state, { type: 'reset_action', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: 0, reason: 'Reset puzzle' }, now).state
  assert.equal(state.checkpoints.first.nodes.puzzle.puzzle?.revision, 1)
  assert.throws(() => executeCommand(h, state, { type: 'save_puzzle', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: 0, value: { order: ['a', 'b', 'c'] } }, now), code('puzzle_conflict'))
  state = executeCommand(h, state, { type: 'submit_puzzle', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: 1, value: { order: ['b', 'a', 'c'] } }, now).state
  state = executeControl(h, state, { type: 'move_checkpoint', checkpointId: 'first', expectedRevision: state.revision, reason: 'Replay puzzle' }, now).state
  assert.equal(state.checkpoints.first.nodes.puzzle.puzzle?.revision, 3)
  assert.throws(() => executeCommand(h, state, { type: 'save_puzzle', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: 0, value: { order: ['a', 'b', 'c'] } }, now), code('puzzle_conflict'))
})

test('word-search bonus slots stay capped across changed order, duplicate submissions, repeated resets and checkpoint reopening', () => {
  const h = bonusWordSearchHunt()
  const submit = (state: GameState, row: number) => executeCommand(h, state, { type: 'submit_puzzle', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: state.checkpoints.first.nodes.puzzle.puzzle!.revision, value: wordPath(row) }, now).state
  const activeAwards = (state: GameState) => state.ledger.filter(entry => entry.kind === 'action_points' && entry.nodeId === 'puzzle' && !state.ledger.some(refund => refund.reverses === entry.id))
  let state = createInitialState(h, 'team', now)

  state = submit(state, 0) // CAT is the required word.
  state = submit(state, 1) // DOG occupies bonus slot 1.
  assert.equal(state.score, 2)
  assert.deepEqual(activeAwards(state).map(entry => entry.id), ['puzzle:first:puzzle:word-search:extra:1'])

  state = executeControl(h, state, { type: 'reset_action', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: state.revision, reason: 'Try another discovery order' }, now).state
  assert.equal(state.checkpoints.first.nodes.puzzle.puzzle?.revision, 3)
  state = submit(state, 1) // DOG is now the required word.
  state = submit(state, 0) // CAT maps to the already-active bonus slot 1.
  const beforeDuplicate = copy(state.ledger)
  state = submit(state, 0)
  assert.deepEqual(state.ledger, beforeDuplicate, 'submitting the same found word cannot add another award')
  assert.equal(state.score, 2)

  state = executeControl(h, state, { type: 'reset_action', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: state.revision, reason: 'First repeated reset' }, now).state
  const revisionAfterFirstReset = state.checkpoints.first.nodes.puzzle.puzzle!.revision
  state = executeControl(h, state, { type: 'reset_action', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: state.revision, reason: 'Second repeated reset' }, now).state
  const revisionAfterSecondReset = state.checkpoints.first.nodes.puzzle.puzzle!.revision
  assert.equal(revisionAfterSecondReset, revisionAfterFirstReset + 1)
  assert.throws(() => executeCommand(h, state, { type: 'submit_puzzle', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: revisionAfterFirstReset, value: wordPath(2) }, now), code('puzzle_conflict'))

  state = submit(state, 1)
  state = submit(state, 0)
  state = submit(state, 2)
  assert.equal(state.status, 'completed')
  assert.equal(state.score, 24, 'two optional words can contribute at most four bonus points')
  assert.equal(activeAwards(state).length, 2)
  assert.equal(activeAwards(state).reduce((sum, entry) => sum + entry.amount, 0), 4)

  const completedRevision = state.checkpoints.first.nodes.puzzle.puzzle!.revision
  const immutableHistory = copy(state.ledger)
  state = executeControl(h, state, { type: 'move_checkpoint', checkpointId: 'first', expectedRevision: state.revision, reason: 'Replay the completed checkpoint' }, later).state
  assert.deepEqual(state.ledger.slice(0, immutableHistory.length), immutableHistory)
  assert.equal(state.score, 0, 'reopening compensates the completed checkpoint and its active puzzle bonuses')
  assert.ok(state.checkpoints.first.nodes.puzzle.puzzle!.revision > completedRevision)
  assert.throws(() => executeCommand(h, state, { type: 'submit_puzzle', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: completedRevision, value: wordPath(0) }, now), code('puzzle_conflict'))

  state = submit(state, 0)
  state = submit(state, 1)
  state = submit(state, 2)
  assert.equal(state.score, 24)
  assert.equal(activeAwards(state).length, 2)
  assert.equal(state.ledger.filter(entry => entry.kind === 'action_points').length, 4, 'the replay appends a new compensated ledger generation')
})

test('word-search hint rewards compensate on hint reset, remain capped on replay, and follow checkpoint compensation', () => {
  const h = hunt()
  h.checkpoints[0].hints = [{ id: 'hint', title: 'Animal search', cost: 3, content: { type: 'puzzle', puzzle: { type: 'word_search', grid: [['C', 'A', 'T'], ['D', 'O', 'G'], ['O', 'W', 'L']], words: ['CAT', 'DOG', 'OWL'], minimumWords: 1, bonusPerExtraWord: 2 }, reveal: { type: 'text', text: 'Look toward the gate.' } } }]
  const submit = (state: GameState, row: number) => executeCommand(h, state, { type: 'submit_hint_puzzle', checkpointId: 'first', hintId: 'hint', expectedRevision: state.hintUsage.hint.puzzle!.revision, value: wordPath(row) }, now)
  const activeHintAwards = (state: GameState) => state.ledger.filter(entry => entry.kind === 'action_points' && entry.hintId === 'hint' && !state.ledger.some(refund => refund.reverses === entry.id))
  let state = createInitialState(h, 'team', now)
  state = executeCommand(h, state, { type: 'use_hint', checkpointId: 'first', hintId: 'hint' }, now).state
  state = submit(state, 0).state
  state = submit(state, 1).state
  assert.equal(state.score, -1)
  const firstGeneration = copy(state.ledger)

  state = executeControl(h, state, { type: 'reset_hint', checkpointId: 'first', hintId: 'hint', expectedRevision: state.revision, reason: 'Reset the puzzle hint' }, now).state
  assert.deepEqual(state.ledger.slice(0, firstGeneration.length), firstGeneration)
  assert.equal(state.score, 0)
  state = executeCommand(h, state, { type: 'use_hint', checkpointId: 'first', hintId: 'hint' }, now).state
  assert.equal(state.hintUsage.hint.puzzle?.revision, 3)
  state = submit(state, 1).state
  state = submit(state, 0).state
  const solved = submit(state, 2)
  state = solved.state
  assert.equal(state.score, 1)
  assert.equal(activeHintAwards(state).length, 2)
  const duplicate = executeCommand(h, state, { type: 'submit_hint_puzzle', checkpointId: 'first', hintId: 'hint', expectedRevision: 5, value: wordPath(2) }, now)
  assert.equal(duplicate.feedback.status, 'already_applied')
  assert.deepEqual(duplicate.state.ledger, state.ledger)

  state = solve(h, state, 'first')
  assert.equal(state.score, 21)
  state = executeControl(h, state, { type: 'move_checkpoint', checkpointId: 'first', expectedRevision: state.revision, reason: 'Replay the main checkpoint' }, later).state
  assert.equal(state.score, -3, 'checkpoint reopening compensates action-point rewards while preserving the hint charge')
  assert.equal(activeHintAwards(state).length, 0)
  state = executeControl(h, state, { type: 'reset_hint', checkpointId: 'first', hintId: 'hint', expectedRevision: state.revision, reason: 'Reset after checkpoint replay' }, later).state
  assert.equal(state.score, 0)
  assert.equal(activeHintAwards(state).length, 0)
  assert.equal(state.hintPuzzleRevisions?.hint, 7)
})

test('puzzle hint reset refunds, keeps generation monotonic and hides prior reward until solved again', () => {
  const h = hunt(); h.checkpoints[0].hints = [{ id: 'hint', title: 'Puzzle clue', cost: 2, content: { type: 'puzzle', puzzle: { type: 'text', prompt: 'Say gate', answers: ['gate'] }, reveal: { type: 'text', text: 'REWARD' } } }]
  let state = createInitialState(h, 'team', now)
  state = executeCommand(h, state, { type: 'use_hint', checkpointId: 'first', hintId: 'hint' }, now).state
  state = executeCommand(h, state, { type: 'submit_hint_puzzle', checkpointId: 'first', hintId: 'hint', expectedRevision: 0, value: { value: 'gate' } }, now).state
  state = executeControl(h, state, { type: 'reset_hint', checkpointId: 'first', hintId: 'hint', expectedRevision: state.revision, reason: 'Reset clue' }, now).state
  state = executeCommand(h, state, { type: 'use_hint', checkpointId: 'first', hintId: 'hint' }, now).state
  assert.equal(state.score, -2); assert.equal(state.hintUsage.hint.puzzle?.revision, 2)
  assert.equal(JSON.stringify(getPlayerView(h, state, now)).includes('REWARD'), false)
  assert.throws(() => executeCommand(h, state, { type: 'save_hint_puzzle', checkpointId: 'first', hintId: 'hint', expectedRevision: 0, value: { value: 'wrong' } }, now), code('puzzle_conflict'))
})

test('photo submission waits for human decision, retry message is public, reference set and media ID stay private', () => {
  const h = hunt([cp('first', [{ id: 'photo', type: 'verify_image', prompt: 'Photograph the gate', referenceImages: ['https://example.com/PRIVATE-REFERENCE.jpg'], next: 'done' }, { id: 'done', type: 'complete' }])])
  const mediaId = '00000000-0000-4000-8000-000000000001'
  let state = createInitialState(h, 'team', now)
  assert.throws(() => executeCommand(h, state, { type: 'continue', checkpointId: 'first', nodeId: 'photo' }, now), code('invalid_action'))
  state = executeCommand(h, state, { type: 'submit_photo', checkpointId: 'first', nodeId: 'photo', mediaId }, now).state
  assert.equal(state.status, 'active'); assert.equal(state.score, 0)
  let view = JSON.stringify(getPlayerView(h, state, now)); assert.equal(view.includes(mediaId), false); assert.equal(view.includes('PRIVATE'), false)
  assert.throws(() => executeCommand(h, state, { type: 'submit_photo', checkpointId: 'first', nodeId: 'photo', mediaId }, now), code('review_pending'))
  state = executeControl(h, state, { type: 'reject_photo', checkpointId: 'first', nodeId: 'photo', expectedRevision: state.revision, reason: 'Include the whole arch' }, now).state
  view = JSON.stringify(getPlayerView(h, state, now)); assert.ok(view.includes('Include the whole arch'))
  state = executeCommand(h, state, { type: 'submit_photo', checkpointId: 'first', nodeId: 'photo', mediaId }, now).state
  state = executeControl(h, state, { type: 'approve_action', checkpointId: 'first', nodeId: 'photo', expectedRevision: state.revision, reason: 'Gate confirmed' }, now).state
  assert.equal(state.status, 'completed'); assert.equal(state.score, 20)
})

test('camera guidance is acknowledgement, organizer verification cannot be forged by player continue', () => {
  const h = hunt([cp('first', [{ id: 'camera', type: 'camera_guide', prompt: 'Align the landmark', referenceImageUrl: 'https://example.com/guide.jpg', next: 'organizer' }, { id: 'organizer', type: 'verify_organizer', prompt: 'Ask the marshal to verify', next: 'done' }, { id: 'done', type: 'complete' }])])
  let state = createInitialState(h, 'team', now)
  state = executeCommand(h, state, { type: 'continue', checkpointId: 'first', nodeId: 'camera' }, now).state
  assert.equal(state.score, 0); assert.throws(() => executeCommand(h, state, { type: 'continue', checkpointId: 'first', nodeId: 'organizer' }, now), code('invalid_action'))
  state = executeControl(h, state, { type: 'approve_action', checkpointId: 'first', nodeId: 'organizer', expectedRevision: state.revision, reason: 'Marshal confirmed' }, now).state
  assert.equal(state.score, 20)
})

test('variables, conditions and point actions compose without exposing private state or farming bonuses', () => {
  const h = hunt([cp('first', [{ id: 'set', type: 'set_variable', key: 'redKey', value: true, next: 'branch' }, { id: 'branch', type: 'branch', condition: { type: 'variable', key: 'redKey', equals: true }, ifTrue: 'bonus', ifFalse: 'ordinary' }, { id: 'bonus', type: 'add_points', amount: 5, label: 'Found the key', next: 'answer' }, { id: 'ordinary', type: 'show_text', text: 'Ordinary path', next: 'answer' }, { id: 'answer', type: 'verify_answer', prompt: 'Answer', answers: ['gate'], next: 'done' }, { id: 'done', type: 'complete' }])])
  let state = createInitialState(h, 'team', now)
  assert.equal(state.score, 5); assert.equal(state.checkpoints.first.activeNodeId, 'answer'); assert.equal(JSON.stringify(getPlayerView(h, state, now)).includes('redKey'), false)
  state = solve(h, state, 'first'); assert.equal(state.score, 25)
  state = executeControl(h, state, { type: 'move_checkpoint', checkpointId: 'first', expectedRevision: state.revision, reason: 'Reset entire checkpoint' }, now).state
  assert.equal(state.score, 5)
  state = solve(h, state, 'first'); assert.equal(state.score, 25)
})

test('daily time branches include overnight UTC windows and weighted random routes are deterministic per team', () => {
  const nodes: FlowNode[] = [{ id: 'branch', type: 'branch', condition: { type: 'time', after: '22:00', before: '06:00' }, ifTrue: 'night', ifFalse: 'day' }, { id: 'night', type: 'show_text', text: 'Night clue', next: 'done' }, { id: 'day', type: 'show_text', text: 'Day clue', next: 'done' }, { id: 'done', type: 'complete' }]
  const h = hunt([cp('first', nodes)])
  assert.equal(createInitialState(h, 'team', '2026-09-17T23:00:00Z').checkpoints.first.activeNodeId, 'night')
  assert.equal(createInitialState(h, 'team', now).checkpoints.first.activeNodeId, 'day')
  h.checkpoints[0].flow.nodes[0] = { id: 'branch', type: 'random_branch', choices: [{ next: 'night', weight: 1 }, { next: 'day', weight: 3 }] }
  assert.equal(createInitialState(h, 'team', now).checkpoints.first.activeNodeId, createInitialState(h, 'team', later).checkpoints.first.activeNodeId)
  const routes = new Set(Array.from({ length: 30 }, (_, i) => createInitialState(h, `team-${i}`, now).checkpoints.first.activeNodeId))
  assert.equal(routes.size, 2)
})

test('map privacy follows none, all and visited settings; independent typed media is allowlisted', () => {
  const h = hunt([cp('first'), cp('second')]); h.checkpoints[1].location = { latitude: 19.25, longitude: 73.13, radiusMeters: 100 }
  let state = createInitialState(h, 'team', now)
  assert.equal(JSON.stringify(getPlayerView(h, state, now)).includes('73.13'), false)
  h.settings = { map: 'visited' }; assert.equal(JSON.stringify(getPlayerView(h, state, now)).includes('73.13'), false)
  state = solve(h, state, 'first'); assert.equal(JSON.stringify(getPlayerView(h, state, now)).includes('73.13'), true)
  h.settings.map = 'all'; assert.equal(getPlayerView(h, state, now).checkpoints?.[1].location?.longitude, 73.13)
  const media = hunt([cp('first', [{ id: 'audio', type: 'show_media', content: { type: 'audio', url: '/media/clue.mp3', title: 'Listen', transcript: 'Follow the bells' }, next: 'done' }, { id: 'done', type: 'complete' }])])
  assert.equal(getPlayerView(media, createInitialState(media, 'team', now), now).node?.type, 'show_media')
})

test('hint availability can require GPS completion without requesting continuous location', () => {
  const h = hunt([cp('first', [{ id: 'gps', type: 'verify_gps', prompt: 'Arrive', latitude: 19, longitude: 73, radiusMeters: 100, maxAccuracyMeters: 50, next: 'answer' }, { id: 'answer', type: 'verify_answer', prompt: 'Answer', answers: ['gate'], next: 'done' }, { id: 'done', type: 'complete' }])]); h.checkpoints[0].hints = [{ id: 'guide', title: 'Landmark guide', cost: 6, content: { type: 'camera', description: 'Find the gate' }, availability: { afterNodeId: 'gps' } }]
  let state = createInitialState(h, 'team', now)
  assert.equal(getPlayerView(h, state, now).hints[0].status, 'locked')
  state = executeCommand(h, state, { type: 'verify_gps', checkpointId: 'first', nodeId: 'gps', location: { latitude: 19, longitude: 73, accuracyMeters: 10 } }, now).state
  assert.equal(getPlayerView(h, state, now).hints[0].status, 'available')
})

test('configuration catches broken fallback, prerequisite cycles, malformed puzzle/media/logic and empty required objective', () => {
  const cases: unknown[] = [
    { ...hunt(), settings: { startsAt: 'tomorrow' } },
    { ...hunt(), theme: { primaryColor: 'url(javascript:alert(1))' } },
    hunt([{ ...cp('first'), required: false }]),
    { ...hunt([{ ...cp('a'), prerequisites: ['b'] }, { ...cp('b'), prerequisites: ['a'] }]), settings: { mode: 'dependency' } },
    hunt([cp('first', [{ id: 'a', type: 'show_text', text: 'Text', next: 'done', fallback: { nodeId: 'a', label: 'Retry', enabled: false } }, { id: 'done', type: 'complete' }])]),
    hunt([cp('first', [{ id: 'a', type: 'show_media', content: { type: 'image', url: '//evil.example/image', alt: 'Image' }, next: 'done' }, { id: 'done', type: 'complete' }])]),
  ]
  for (const value of cases) assert.ok(validateHunt(value).length, JSON.stringify(value))
  const malformed = copy(puzzleHunt()); (malformed.checkpoints[0].flow.nodes[0] as { puzzle: unknown }).puzzle = { type: 'sequence', items: [], solution: [] }
  assert.ok(validateHunt(malformed).length)
  assert.throws(() => parseCommand({ type: 'submit_puzzle', checkpointId: 'first', nodeId: 'puzzle', expectedRevision: -1, value: {} }), code('invalid_command'))
  assert.throws(() => parseControl({ type: 'adjust_score', amount: 10, reason: 'No revision' }), code('invalid_override'))
  assert.throws(() => parseControl({ type: 'adjust_score', amount: 10, reason: 'Hack', expectedRevision: 0, score: 999 }), code('invalid_override'))
})

test('maximum acyclic automatic flow length does not overflow the JavaScript stack', () => {
  const checkpoints = Array.from({ length: 100 }, (_, i) => cp(`cp-${i}`, [...Array.from({ length: 199 }, (_, j): FlowNode => ({ id: `n-${j}`, type: 'set_variable', key: 'progress', value: j, next: j === 198 ? 'done' : `n-${j + 1}` })), { id: 'done', type: 'complete' }]))
  const h = hunt(checkpoints), state = createInitialState(h, 'team', now)
  assert.equal(state.status, 'completed'); assert.equal(state.score, 2000)
})
