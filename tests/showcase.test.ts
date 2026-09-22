import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createInitialState, executeCommand, executeControl, getPlayerView, validateHunt, type GameCommand, type GameState, type HuntDefinition } from '../lib/engine'
import { exampleHunt } from '../lib/engine/example'
import { huntTemplates, instantiateTemplate } from '../lib/engine/templates'

const now = '2026-09-17T10:00:00.000Z'
function runner(hunt = exampleHunt, original?: GameState) {
  let state = original ?? createInitialState(hunt, 'showcase-team', now)
  return { get state() { return state }, send(command: GameCommand) { const result = executeCommand(hunt, state, command, now); state = result.state; return result.feedback }, next(checkpointId: string, nodeId: string) { state = executeCommand(hunt, state, { type: 'continue', checkpointId, nodeId }, now).state } }
}

test('six-checkpoint showcase can be played completely with tabletop recovery and all puzzle validation', () => {
  assert.deepEqual(validateHunt(exampleHunt), []); assert.equal(exampleHunt.checkpoints.length, 6)
  const game = runner()
  game.next('beginning', 'clue')
  game.send({ type: 'verify', checkpointId: 'beginning', nodeId: 'riddle', value: 'compass' })
  game.next('beginning', 'fragment')
  game.next('hidden-qr', 'find')
  assert.equal(game.send({ type: 'verify', checkpointId: 'hidden-qr', nodeId: 'scan', value: 'wrong' }).scannerShouldStop, false)
  assert.equal(game.send({ type: 'verify', checkpointId: 'hidden-qr', nodeId: 'scan', value: 'demo-coffee-stash' }).status, 'dud')
  assert.equal(game.send({ type: 'verify', checkpointId: 'hidden-qr', nodeId: 'scan', value: 'K7DM2Q' }).scannerShouldStop, true)
  game.next('hidden-qr', 'fragment')
  game.next('landmark', 'clue')
  game.send({ type: 'use_fallback', checkpointId: 'landmark', nodeId: 'nearby' })
  game.send({ type: 'verify', checkpointId: 'landmark', nodeId: 'workshop', value: 'KALYAN' })
  game.next('landmark', 'camera')
  game.send({ type: 'choose_path', checkpointId: 'landmark', nodeId: 'verification', choiceId: 'observation' })
  game.send({ type: 'verify', checkpointId: 'landmark', nodeId: 'question', value: 'arch' })
  game.next('landmark', 'fragment')
  game.send({ type: 'submit_puzzle', checkpointId: 'puzzle-chain', nodeId: 'jigsaw', expectedRevision: 0, value: { order: ['sky', 'copper', 'fern', 'stone'] } })
  game.send({ type: 'submit_puzzle', checkpointId: 'puzzle-chain', nodeId: 'words', expectedRevision: 0, value: { path: [0, 1, 2, 3].map(column => ({ row: 0, column })) } })
  assert.equal(game.state.checkpoints['puzzle-chain'].activeNodeId, 'words')
  game.send({ type: 'submit_puzzle', checkpointId: 'puzzle-chain', nodeId: 'words', expectedRevision: 1, value: { path: [0, 1, 2].map(column => ({ row: 2, column })) } })
  game.send({ type: 'verify', checkpointId: 'puzzle-chain', nodeId: 'answer', value: 'gate' })
  game.next('puzzle-chain', 'fragment')
  game.send({ type: 'choose_path', checkpointId: 'alternate', nodeId: 'route', choiceId: 'qr' })
  game.send({ type: 'verify', checkpointId: 'alternate', nodeId: 'scan', value: 'CROSSING' })
  game.next('alternate', 'fragment')
  assert.equal(game.state.activeCheckpointId, 'finale')
  assert.equal(Object.keys(game.state.variables ?? {}).length, 5)
  game.send({ type: 'submit_puzzle', checkpointId: 'finale', nodeId: 'final-puzzle', expectedRevision: 0, value: { value: 'LOOK BEYOND THE OLD GATE' } })
  game.next('finale', 'celebrate')
  assert.equal(game.state.status, 'completed'); assert.equal(game.state.score, 120)
  assert.equal(game.state.ledger.filter(entry => entry.kind === 'checkpoint_completed').length, 6)
  assert.equal(getPlayerView(exampleHunt, game.state, now).summary?.hintsUsed, 0)
})

test('Kalyan landmark has exact four configured prices, arbitrary hint order, GPS guidance and human photo verification', () => {
  const landmark = exampleHunt.checkpoints.find(cp => cp.id === 'landmark')!
  assert.equal(landmark.basePoints, 20)
  assert.deepEqual(landmark.hints.slice(0, 4).map(hint => hint.cost), [2, 4, 5, 6])
  let state = createInitialState(exampleHunt, 'photo-team', now)
  state = executeControl(exampleHunt, state, { type: 'move_checkpoint', checkpointId: 'landmark', expectedRevision: state.revision, reason: 'Workshop test jump' }, now).state
  const game = runner(exampleHunt, state)
  game.next('landmark', 'clue')
  for (const hintId of ['landmark-camera', 'landmark-map', 'landmark-text', 'landmark-navigation']) game.send({ type: 'use_hint', checkpointId: 'landmark', hintId })
  assert.equal(game.state.score, -17)
  game.send({ type: 'use_hint', checkpointId: 'landmark', hintId: 'landmark-camera' }); assert.equal(game.state.score, -17)
  game.send({ type: 'verify_gps', checkpointId: 'landmark', nodeId: 'nearby', location: { latitude: 19.2403, longitude: 73.1305, accuracyMeters: 10 } })
  assert.equal(getPlayerView(exampleHunt, game.state, now).node?.type, 'camera_guide')
  game.next('landmark', 'camera')
  game.send({ type: 'choose_path', checkpointId: 'landmark', nodeId: 'verification', choiceId: 'photo' })
  game.send({ type: 'submit_photo', checkpointId: 'landmark', nodeId: 'photo', mediaId: '00000000-0000-4000-8000-000000000001' })
  assert.equal(game.state.checkpoints.landmark.nodes.photo.photoStatus, 'pending')
  state = executeControl(exampleHunt, game.state, { type: 'approve_action', checkpointId: 'landmark', nodeId: 'photo', expectedRevision: game.state.revision, reason: 'Landmark reference confirmed' }, now).state
  state = executeCommand(exampleHunt, state, { type: 'continue', checkpointId: 'landmark', nodeId: 'fragment' }, now).state
  assert.equal(state.score, 3, '20 points minus 2, 4, 5 and 6 exactly once')
})

test('alternate checkpoint genuinely supports GPS plus code and a live fallback after a missing QR', () => {
  let state = createInitialState(exampleHunt, 'alternative-team', now)
  state = executeControl(exampleHunt, state, { type: 'move_checkpoint', checkpointId: 'alternate', expectedRevision: state.revision, reason: 'Test alternative route' }, now).state
  const game = runner(exampleHunt, state)
  game.send({ type: 'choose_path', checkpointId: 'alternate', nodeId: 'route', choiceId: 'qr' })
  game.send({ type: 'use_fallback', checkpointId: 'alternate', nodeId: 'scan' })
  assert.equal(game.state.checkpoints.alternate.activeNodeId, 'nearby')
  game.send({ type: 'verify_gps', checkpointId: 'alternate', nodeId: 'nearby', location: { latitude: 19.2403, longitude: 73.1305, accuracyMeters: 15 } })
  assert.equal(game.state.checkpoints.alternate.activeNodeId, 'code')
  game.send({ type: 'verify', checkpointId: 'alternate', nodeId: 'code', value: 'ADVENTURE' })
  game.next('alternate', 'fragment')
  assert.equal(game.state.checkpoints.alternate.status, 'completed'); assert.equal(game.state.score, 20)
})

test('all starter templates validate and independent instances regenerate QR secrets without mutating the template', () => {
  assert.deepEqual(huntTemplates.map(item => item.id), ['frankie-code-hunt', 'simple-qr', 'puzzle-trail', 'landmark'])
  for (const template of huntTemplates) assert.deepEqual(validateHunt(template.definition), [], template.id)
  const frankie = huntTemplates.find(template => template.id === 'frankie-code-hunt')!
  assert.equal(frankie.definition.checkpoints.length, 5)
  assert.equal(frankie.definition.settings?.ranking, 'points_time')
  assert.ok(frankie.definition.description?.includes('\n\n'))
  assert.ok(frankie.definition.checkpoints.every(checkpoint => checkpoint.hints.length > 0 && checkpoint.timeBonus))
  const one = instantiateTemplate('simple-qr'), two = instantiateTemplate('simple-qr')
  const simple = huntTemplates.find(template => template.id === 'simple-qr')!
  assert.notEqual(one.id, two.id)
  const tokens = (definition: HuntDefinition) => definition.checkpoints.flatMap(cp => cp.flow.nodes.flatMap(node => node.type === 'verify_qr' ? [node.token] : []))
  assert.notDeepEqual(tokens(one), tokens(two)); assert.notDeepEqual(tokens(one), tokens(simple.definition))
  one.checkpoints[0].title = 'Different'
  assert.notEqual(simple.definition.checkpoints[0].title, 'Different')
  assert.deepEqual(validateHunt(one), []); assert.equal(two.version, 1)
})

test('Frankie code hunt plays through all five rounds with server-checked answers, puzzle and speed scoring', () => {
  const hunt = huntTemplates.find(template => template.id === 'frankie-code-hunt')!.definition
  const game = runner(hunt)
  assert.equal(game.send({ type: 'verify', checkpointId: 'shared-wrap', nodeId: 'answer', value: 'bread' }).status, 'accepted')
  game.send({ type: 'verify', checkpointId: 'cold-case', nodeId: 'answer', value: 'fridge' })
  game.send({ type: 'verify', checkpointId: 'spice-code', nodeId: 'answer', value: 'sauce' })
  game.send({ type: 'submit_puzzle', checkpointId: 'word-grid', nodeId: 'puzzle', expectedRevision: 0, value: { path: Array.from({ length: 6 }, (_, index) => ({ row: index, column: index })) } })
  game.send({ type: 'verify', checkpointId: 'final-order', nodeId: 'answer', value: 'frankie' })
  assert.equal(game.state.status, 'completed')
  assert.equal(game.state.score, 125)
  assert.equal(game.state.ledger.filter(entry => entry.kind === 'checkpoint_completed').length, 5)
  assert.equal(game.state.ledger.filter(entry => entry.kind === 'time_bonus').length, 5)
})

test('showcase vector assets exist locally and require no image or vision service', async () => {
  const urls = new Set(JSON.stringify([exampleHunt, ...huntTemplates]).match(/\/v2\/demo\/[A-Za-z0-9-]+\.svg/g) ?? [])
  assert.ok(urls.size >= 8)
  for (const url of urls) {
    const asset = await readFile(new URL(`../public${url}`, import.meta.url), 'utf8')
    assert.ok(asset.startsWith('<svg')); assert.equal(/<script|onload=|<foreignObject|href="https?:/i.test(asset), false)
  }
})
