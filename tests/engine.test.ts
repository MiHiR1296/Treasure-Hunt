import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialState, EngineError, executeCommand, executeOverride, getPlayerView,
  parseCommand, parseHuntDefinition, validateHunt, type GameCommand, type HuntDefinition,
} from '../lib/engine'
import { exampleHunt } from '../lib/engine/example'

const now = '2026-09-17T10:00:00.000Z'
const later = '2026-09-17T10:05:00.000Z'
const definition = (): HuntDefinition => ({
  schemaVersion: 1, id: 'test-hunt', version: 1, title: 'Test Adventure',
  dudQrs: [{ token: 'a-decoy-token', message: 'Only a coffee stash here!' }],
  checkpoints: [
    {
      id: 'first', title: 'First checkpoint', basePoints: 20,
      flow: {
        startNodeId: 'clue', nodes: [
          { id: 'clue', type: 'show_text', text: 'Find the gate.', next: 'qr' },
          { id: 'qr', type: 'verify_qr', prompt: 'Scan the gate code.', token: 'a-SECRET-qr-token', backupCode: 'FALLBACK', next: 'route' },
          { id: 'route', type: 'choose_path', prompt: 'Choose how to verify.', choices: [{ id: 'answer', label: 'Answer', next: 'question' }, { id: 'gps', label: 'Location', next: 'location' }] },
          { id: 'question', type: 'verify_answer', prompt: 'What do you see?', answers: ['the old gate'], recapAnswer: 'The old gate', next: 'done' },
          { id: 'location', type: 'verify_gps', prompt: 'Check your location.', latitude: 19.2403, longitude: 73.1305, radiusMeters: 100, maxAccuracyMeters: 50, next: 'done' },
          { id: 'done', type: 'complete' },
        ],
      },
      hints: [
        { id: 'hint-one', title: 'Text hint', cost: 2, content: { type: 'text', text: 'A SECRET hint near the gate.' } },
        { id: 'hint-two', title: 'Map hint', cost: 4, content: { type: 'map', latitude: 19.2403, longitude: 73.1305, radiusMeters: 150 } },
        { id: 'hint-three', title: 'Image hint', cost: 6, content: { type: 'image', url: 'https://example.com/SECRET.jpg', alt: 'Gate reference' } },
        { id: 'hint-delayed', title: 'Later hint', cost: 1, content: { type: 'text', text: 'Almost there.' }, availability: { afterHintIds: ['hint-one'], afterSeconds: 300 } },
      ],
    },
    {
      id: 'second', title: 'Second checkpoint', basePoints: 10,
      flow: { startNodeId: 'code', nodes: [{ id: 'code', type: 'verify_code', prompt: 'Enter the final code.', code: 'FINISH', next: 'done' }, { id: 'done', type: 'complete' }] },
      hints: [{ id: 'final-hint', title: 'Final hint', cost: 1, content: { type: 'text', text: 'The end.' } }],
    },
  ],
})

const errorCode = (code: string) => (error: unknown) => error instanceof EngineError && error.code === code
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function reachRoute(hunt = definition()) {
  let state = createInitialState(hunt, 'team-a', now)
  state = executeCommand(hunt, state, { type: 'continue', checkpointId: 'first', nodeId: 'clue' }, now).state
  state = executeCommand(hunt, state, { type: 'verify', checkpointId: 'first', nodeId: 'qr', value: 'a-SECRET-qr-token' }, now).state
  return state
}

function finishFirst(hunt = definition()) {
  let state = reachRoute(hunt)
  state = executeCommand(hunt, state, { type: 'choose_path', checkpointId: 'first', nodeId: 'route', choiceId: 'answer' }, now).state
  return executeCommand(hunt, state, { type: 'verify', checkpointId: 'first', nodeId: 'question', value: 'THE   OLD GATE ' }, now).state
}

test('valid fixture and example validate; initializing starts only the first checkpoint', () => {
  assert.deepEqual(validateHunt(definition()), [])
  assert.deepEqual(validateHunt(exampleHunt), [])
  const state = createInitialState(definition(), 'team-a', now)
  assert.equal(state.activeCheckpointId, 'first')
  assert.equal(state.checkpoints.first.activeNodeId, 'clue')
  assert.equal(state.checkpoints.second.status, 'locked')
  assert.equal(state.score, 0)
  assert.equal(state.events[0].type, 'checkpoint_started')
})

test('player history contains only reached stages and safe accepted responses', () => {
  const hunt = definition()
  let state = createInitialState(hunt, 'team-a', now)
  let view = getPlayerView(hunt, state, now)
  assert.equal(view.stages?.length, 1)
  assert.equal(view.checkpoints?.[1].title, 'Stage 2')
  assert.ok(!JSON.stringify(view).includes('Enter the final code.'))
  assert.ok(!JSON.stringify(view).includes('FINISH'))

  state = executeCommand(hunt, state, { type: 'continue', checkpointId: 'first', nodeId: 'clue' }, now).state
  state = executeCommand(hunt, state, { type: 'verify', checkpointId: 'first', nodeId: 'qr', value: 'a-SECRET-qr-token' }, now).state
  state = executeCommand(hunt, state, { type: 'choose_path', checkpointId: 'first', nodeId: 'route', choiceId: 'answer' }, now).state
  state = executeCommand(hunt, state, { type: 'verify', checkpointId: 'first', nodeId: 'question', value: 'the old gate' }, now).state
  view = getPlayerView(hunt, state, now)
  const first = view.stages?.find(stage => stage.id === 'first')
  assert.equal(first?.status, 'completed')
  assert.equal(first?.steps.find(step => step.id === 'qr')?.response, 'QR scanned')
  assert.equal(first?.steps.find(step => step.id === 'route')?.response, 'Answer')
  assert.equal(first?.steps.find(step => step.id === 'question')?.response, 'The old gate')
  assert.ok(!JSON.stringify(view).includes('a-SECRET-qr-token'))
  assert.equal(view.stages?.some(stage => stage.id === 'second'), true, 'the newly reached current stage is available')
})

test('hint 3 can be purchased first and its identity survives persistence', () => {
  const hunt = definition()
  const before = createInitialState(hunt, 'team-a', now)
  const snapshot = copy(before)
  const after = executeCommand(hunt, before, { type: 'use_hint', checkpointId: 'first', hintId: 'hint-three' }, now).state
  assert.deepEqual(before, snapshot, 'transition must not mutate input')
  assert.equal(after.score, -6, 'hint spending can produce a negative interim score')
  assert.deepEqual(Object.keys(after.hintUsage), ['hint-three'])
  const view = getPlayerView(hunt, copy(after), later)
  assert.equal(view.hints[0].status, 'available')
  assert.equal(view.hints[2].status, 'used')
  assert.equal(view.hints[2].content?.type, 'image')
})

test('repeated hint purchases by separate teammates charge exactly once', () => {
  const hunt = definition()
  const command: GameCommand = { type: 'use_hint', checkpointId: 'first', hintId: 'hint-two' }
  const original = createInitialState(hunt, 'team-a', now)
  const phoneA = executeCommand(hunt, original, command, now)
  // The transaction adapter must give phone B the latest persisted state.
  const phoneB = executeCommand(hunt, copy(phoneA.state), command, later)
  assert.equal(phoneB.feedback.status, 'already_applied')
  assert.equal(phoneB.state.score, -4)
  assert.equal(phoneB.state.ledger.length, 1)
  assert.equal(phoneB.state.revision, phoneA.state.revision)
  assert.equal(phoneB.state.events.filter(event => event.type === 'hint_used').length, 1)
})

test('hint dependencies and delays are independent and enforced on the server', () => {
  const hunt = definition()
  let state = createInitialState(hunt, 'team-a', now)
  const command: GameCommand = { type: 'use_hint', checkpointId: 'first', hintId: 'hint-delayed' }
  assert.throws(() => executeCommand(hunt, state, command, later), errorCode('hint_locked'))
  state = executeCommand(hunt, state, { type: 'use_hint', checkpointId: 'first', hintId: 'hint-one' }, now).state
  assert.throws(() => executeCommand(hunt, state, command, now), errorCode('hint_locked'))
  assert.equal(getPlayerView(hunt, state, later).hints[3].status, 'available')
  state = executeCommand(hunt, state, command, later).state
  assert.equal(state.score, -3)
})

test('hints cannot be bought in locked or different checkpoints', () => {
  const hunt = definition()
  const state = createInitialState(hunt, 'team-a', now)
  assert.throws(() => executeCommand(hunt, state, { type: 'use_hint', checkpointId: 'second', hintId: 'final-hint' }, now), errorCode('stale_action'))
  assert.throws(() => executeCommand(hunt, state, { type: 'use_hint', checkpointId: 'second', hintId: 'hint-one' }, now), errorCode('invalid_hint'))
})

test('wrong and dud QR scans keep current action active and scanner running', () => {
  const hunt = definition()
  let state = createInitialState(hunt, 'team-a', now)
  state = executeCommand(hunt, state, { type: 'continue', checkpointId: 'first', nodeId: 'clue' }, now).state
  for (const token of ['wrong-one', 'wrong-two', 'a-decoy-token']) {
    const result = executeCommand(hunt, state, { type: 'verify', checkpointId: 'first', nodeId: 'qr', value: token }, now)
    assert.equal(result.feedback.scannerShouldStop, false)
    assert.equal(result.feedback.status, token === 'a-decoy-token' ? 'dud' : 'rejected')
    assert.equal(result.state.checkpoints.first.activeNodeId, 'qr')
    assert.equal(result.state.score, 0)
    state = result.state
  }
  assert.equal(state.checkpoints.first.nodes.qr.attempts, 3)
  assert.equal(state.events.at(-1)?.type, 'dud_qr_scanned')
  assert.ok(!JSON.stringify(state).includes('a-decoy-token'), 'audit stores outcomes, not submitted tokens')
  const success = executeCommand(hunt, state, { type: 'verify', checkpointId: 'first', nodeId: 'qr', value: 'a-SECRET-qr-token' }, now)
  assert.equal(success.feedback.scannerShouldStop, true)
  assert.equal(success.state.checkpoints.first.activeNodeId, 'route')
})

test('configured backup code recovers camera failure; absent backup does not verify', () => {
  const hunt = definition()
  let state = createInitialState(hunt, 'team-a', now)
  state = executeCommand(hunt, state, { type: 'continue', checkpointId: 'first', nodeId: 'clue' }, now).state
  assert.equal(executeCommand(hunt, state, { type: 'verify', checkpointId: 'first', nodeId: 'qr', value: '  fallback ' }, now).feedback.status, 'accepted')
  const qr = hunt.checkpoints[0].flow.nodes[1]
  if (qr.type !== 'verify_qr') throw new Error('bad fixture')
  delete qr.backupCode
  assert.equal(executeCommand(hunt, state, { type: 'verify', checkpointId: 'first', nodeId: 'qr', value: 'FALLBACK' }, now).feedback.status, 'rejected')
})

test('an old node submission cannot complete the next node or next checkpoint', () => {
  const hunt = definition()
  const state = finishFirst(hunt)
  const snapshot = copy(state)
  assert.equal(state.activeCheckpointId, 'second')
  assert.equal(state.score, 20)
  assert.throws(() => executeCommand(hunt, state, { type: 'verify', checkpointId: 'first', nodeId: 'question', value: 'the old gate' }, now), errorCode('stale_action'))
  assert.deepEqual(state, snapshot)
  assert.equal(state.checkpoints.first.nodes.location.status, 'skipped')
})

test('wrong answer retries remain at the question; continue cannot bypass verification', () => {
  const hunt = definition()
  let state = reachRoute(hunt)
  state = executeCommand(hunt, state, { type: 'choose_path', checkpointId: 'first', nodeId: 'route', choiceId: 'answer' }, now).state
  const wrong = executeCommand(hunt, state, { type: 'verify', checkpointId: 'first', nodeId: 'question', value: 'wrong' }, now)
  assert.equal(wrong.feedback.status, 'rejected')
  assert.equal(wrong.state.checkpoints.first.activeNodeId, 'question')
  assert.throws(() => executeCommand(hunt, wrong.state, { type: 'continue', checkpointId: 'first', nodeId: 'question' }, now), errorCode('invalid_action'))
})

test('GPS handles uncertainty and distance, then completes the alternate route', () => {
  const hunt = definition()
  let state = reachRoute(hunt)
  state = executeCommand(hunt, state, { type: 'choose_path', checkpointId: 'first', nodeId: 'route', choiceId: 'gps' }, now).state
  const submit = (latitude: number, longitude: number, accuracyMeters: number) => executeCommand(hunt, state, { type: 'verify_gps', checkpointId: 'first', nodeId: 'location', location: { latitude, longitude, accuracyMeters } }, now)
  assert.equal(submit(19.2403, 73.1305, 500).feedback.status, 'rejected')
  assert.equal(submit(20, 74, 10).feedback.status, 'rejected')
  state = submit(19.2403, 73.1305, 15).state
  assert.equal(state.activeCheckpointId, 'second')
  assert.equal(state.score, 20)
  assert.equal(state.checkpoints.first.nodes.question.status, 'skipped')
})

test('hint charges and completion awards sum without deducting hints twice', () => {
  const hunt = definition()
  let state = reachRoute(hunt)
  state = executeCommand(hunt, state, { type: 'use_hint', checkpointId: 'first', hintId: 'hint-two' }, now).state
  state = executeCommand(hunt, state, { type: 'choose_path', checkpointId: 'first', nodeId: 'route', choiceId: 'answer' }, now).state
  state = executeCommand(hunt, state, { type: 'verify', checkpointId: 'first', nodeId: 'question', value: 'the old gate' }, now).state
  assert.equal(state.score, 16)
  const retry = executeCommand(hunt, state, { type: 'use_hint', checkpointId: 'first', hintId: 'hint-two' }, later)
  assert.equal(retry.feedback.status, 'already_applied')
  assert.equal(retry.state.score, 16)
  state = executeCommand(hunt, state, { type: 'verify', checkpointId: 'second', nodeId: 'code', value: 'finish' }, now).state
  assert.equal(state.status, 'completed')
  assert.equal(state.score, 26)
  assert.deepEqual(state.ledger.map(entry => entry.amount), [-4, 20, 10])
  assert.equal(getPlayerView(hunt, state, later).node, null)
  assert.throws(() => executeCommand(hunt, state, { type: 'verify', checkpointId: 'second', nodeId: 'code', value: 'finish' }, later), errorCode('stale_action'))
})

test('refresh restores current task and public views never include secret configuration', () => {
  const hunt = definition()
  const state = reachRoute(hunt)
  const view = getPlayerView(hunt, copy(state), later)
  assert.equal(view.node?.type, 'choose_path')
  const serialized = JSON.stringify(view)
  for (const secret of ['a-SECRET-qr-token', 'FALLBACK', 'the old gate', 'FINISH', 'SECRET.jpg', 'A SECRET hint', 'a-decoy-token']) assert.ok(!serialized.includes(secret), `${secret} leaked`)
  assert.ok(!serialized.includes('73.1305'), 'unbought map content and future GPS coordinates stay private')
  assert.ok(!serialized.includes('"next"'))
  assert.ok(!serialized.includes('"answers"'))
  assert.ok(!serialized.includes('"ledger"'))
})

test('organizer approval advances normally, audits reason, and refuses stale replay', () => {
  const hunt = definition()
  let state = createInitialState(hunt, 'team-a', now)
  state = executeOverride(hunt, state, { checkpointId: 'first', nodeId: 'clue', reason: 'Starting late' }, now).state
  state = executeOverride(hunt, state, { checkpointId: 'first', nodeId: 'qr', reason: 'The printed QR was damaged.' }, now).state
  assert.equal(state.checkpoints.first.activeNodeId, 'route')
  assert.equal(state.events.filter(event => event.type === 'organizer_override').length, 2)
  assert.equal(state.events.find(event => event.reason === 'The printed QR was damaged.')?.nodeId, 'qr')
  assert.throws(() => executeOverride(hunt, state, { checkpointId: 'first', nodeId: 'qr', reason: 'Retry' }, now), errorCode('stale_action'))
  assert.throws(() => executeOverride(hunt, state, { checkpointId: 'first', nodeId: 'route', reason: 'Choose for them' }, now), errorCode('invalid_override'))
  state = executeCommand(hunt, state, { type: 'choose_path', checkpointId: 'first', nodeId: 'route', choiceId: 'answer' }, now).state
  state = executeOverride(hunt, state, { checkpointId: 'first', nodeId: 'question', reason: 'Spoken answer verified.' }, now).state
  assert.equal(state.score, 20)
  assert.equal(state.activeCheckpointId, 'second')
})

test('sessions reject changed published version and inconsistent score', () => {
  const hunt = definition()
  const state = createInitialState(hunt, 'team-a', now)
  assert.throws(() => getPlayerView({ ...hunt, version: 2 }, state, now), errorCode('version_mismatch'))
  assert.throws(() => getPlayerView(hunt, { ...state, score: 999 }, now), errorCode('invalid_state'))
})

test('command parsing rejects unknown types, extra fields, invalid GPS, and arbitrary completion', () => {
  for (const value of [
    null, [], { type: 'complete_checkpoint', checkpointId: 'first', nodeId: 'qr' },
    { type: 'continue', checkpointId: 'first', nodeId: 'clue', score: 100 },
    { type: 'verify', checkpointId: 'first', nodeId: 'qr', value: '' },
    { type: 'verify_gps', checkpointId: 'first', nodeId: 'location', location: { latitude: 100, longitude: 73, accuracyMeters: 10 } },
    { type: 'verify_gps', checkpointId: 'first', nodeId: 'location', location: { latitude: 19, longitude: 73, accuracyMeters: Number.NaN } },
    { type: 'use_hint', checkpointId: 'first', hintId: 'constructor' },
  ]) assert.throws(() => parseCommand(value), errorCode('invalid_command'))
})

test('publishing rejects missing targets, cycles, unreachable nodes, unsupported actions, and duplicate IDs', () => {
  const cases: Array<(hunt: HuntDefinition) => void> = [
    hunt => { hunt.checkpoints[0].flow.startNodeId = 'missing' },
    hunt => { const node = hunt.checkpoints[0].flow.nodes[0]; if ('next' in node) node.next = 'missing' },
    hunt => { const node = hunt.checkpoints[0].flow.nodes[0]; if ('next' in node) node.next = 'clue' },
    hunt => { hunt.checkpoints[0].flow.nodes.push({ id: 'unreachable', type: 'complete' }) },
    hunt => { (hunt.checkpoints[0].flow.nodes[0] as { type: string }).type = 'verify_image' },
    hunt => { hunt.checkpoints[1].id = 'first' },
    hunt => { hunt.checkpoints[0].flow.nodes[1].id = 'clue' },
    hunt => { hunt.checkpoints[1].hints[0].id = 'hint-one' },
    hunt => { hunt.checkpoints[0].hints[0].id = 'isPrototypeOf' },
    hunt => { hunt.checkpoints[0].hints[0].availability = { afterHintIds: ['missing'] } },
    hunt => { hunt.checkpoints[0].hints[0].availability = { afterHintIds: ['hint-delayed'] } },
    hunt => { hunt.dudQrs![0].token = 'a-SECRET-qr-token' },
    hunt => { hunt.checkpoints[0].basePoints = -1 },
  ]
  for (const mutate of cases) {
    const hunt = definition(); mutate(hunt)
    assert.ok(validateHunt(hunt).length > 0)
    assert.throws(() => parseHuntDefinition(hunt), errorCode('invalid_definition'))
  }
  assert.throws(() => parseHuntDefinition({ ...definition(), unknownFeature: true }), errorCode('invalid_definition'))
})

test('configuration parser returns a detached published snapshot', () => {
  const input = definition()
  const published = parseHuntDefinition(input)
  input.checkpoints[0].basePoints = 999
  assert.equal(published.checkpoints[0].basePoints, 20)
})
