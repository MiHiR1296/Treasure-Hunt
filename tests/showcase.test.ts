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
  assert.equal(frankie.definition.checkpoints.length, 8)
  assert.equal(frankie.definition.settings?.ranking, 'points_time')
  assert.ok(frankie.definition.description?.includes('\n\n'))
  assert.ok(frankie.definition.checkpoints.every(checkpoint => checkpoint.hints.length > 0 && checkpoint.timeBonus))
  const one = instantiateTemplate('simple-qr'), two = instantiateTemplate('simple-qr')
  const frankieCopy = instantiateTemplate('frankie-code-hunt')
  const simple = huntTemplates.find(template => template.id === 'simple-qr')!
  assert.notEqual(one.id, two.id)
  const tokens = (definition: HuntDefinition) => definition.checkpoints.flatMap(cp => cp.flow.nodes.flatMap(node => node.type === 'verify_qr' ? [node.token] : []))
  assert.notDeepEqual(tokens(one), tokens(two)); assert.notDeepEqual(tokens(one), tokens(simple.definition))
  const fridge = frankieCopy.checkpoints.flatMap(checkpoint => checkpoint.flow.nodes).find(node => node.type === 'verify_qr')
  assert.equal(fridge?.type === 'verify_qr' ? fridge.backupCode : undefined, 'KEEP IT COOL', 'deliberate printed phrases remain readable')
  assert.notEqual(fridge?.type === 'verify_qr' ? fridge.token : undefined, 'template-fridge-marker')
  one.checkpoints[0].title = 'Different'
  assert.notEqual(simple.definition.checkpoints[0].title, 'Different')
  assert.deepEqual(validateHunt(one), []); assert.equal(two.version, 1)
})

test('Frankie challenge plays all eight stages, awards extra ingredient finds, and preserves its unlocked-word history', () => {
  const hunt = huntTemplates.find(template => template.id === 'frankie-code-hunt')!.definition
  const game = runner(hunt)
  const campaignPhrase = 'GOOD FOOD TURNS STRANGERS INTO A TEAM'
  const initialView = getPlayerView(hunt, game.state, now)
  assert.equal(initialView.hunt.settings?.completionMessage, undefined)
  assert.equal(JSON.stringify(initialView).includes(campaignPhrase), false)
  assert.equal(game.send({ type: 'verify', checkpointId: 'name-the-snack', nodeId: 'answer', value: 'roll' }).status, 'accepted')
  game.next('name-the-snack', 'word')
  game.send({ type: 'submit_puzzle', checkpointId: 'frankie-picture', nodeId: 'puzzle', expectedRevision: 0, value: { order: ['mint', 'copper', 'sesame', 'amber', 'paneer', 'chilli', 'onion', 'roti', 'plate'] } })
  game.next('frankie-picture', 'word')
  const ingredientPaths = [
    Array.from({ length: 6 }, (_, index) => ({ row: 5 - index, column: 1 })),
    Array.from({ length: 7 }, (_, index) => ({ row: 2, column: 7 - index })),
    Array.from({ length: 6 }, (_, index) => ({ row: index + 2, column: 7 })),
    Array.from({ length: 5 }, (_, index) => ({ row: index + 2, column: index })),
    Array.from({ length: 5 }, (_, index) => ({ row: 3, column: index + 2 })),
    Array.from({ length: 6 }, (_, index) => ({ row: 7 - index, column: 6 - index })),
    Array.from({ length: 6 }, (_, index) => ({ row: 5 - index, column: index })),
    Array.from({ length: 4 }, (_, index) => ({ row: index + 4, column: index + 4 })),
  ]
  ingredientPaths.forEach((path, expectedRevision) => game.send({ type: 'submit_puzzle', checkpointId: 'ingredient-search', nodeId: 'puzzle', expectedRevision, value: { path } }))
  assert.equal(game.state.ledger.filter(entry => entry.reason?.startsWith('Extra ingredient:')).length, 5)
  game.next('ingredient-search', 'word')
  game.send({ type: 'verify', checkpointId: 'coldest-door', nodeId: 'scan', value: 'keep it cool' })
  game.next('coldest-door', 'word')
  game.send({ type: 'submit_puzzle', checkpointId: 'match-the-parts', nodeId: 'puzzle', expectedRevision: 0, value: { pairs: [{ leftId: 'roti', rightId: 'wrap' }, { leftId: 'paneer', rightId: 'filling' }, { leftId: 'onion', rightId: 'crunch' }, { leftId: 'sauce', rightId: 'tang' }] } })
  game.next('match-the-parts', 'word')
  game.send({ type: 'submit_puzzle', checkpointId: 'ingredient-crossword', nodeId: 'puzzle', expectedRevision: 0, value: { grid: [
    ['', '', '', '', '', ''], ['', '', 'O', '', '', ''], ['P', 'A', 'N', 'E', 'E', 'R'],
    ['C', 'H', 'I', 'L', 'L', 'I'], ['', '', 'O', '', '', ''], ['', '', 'N', '', '', ''],
  ] } })
  game.next('ingredient-crossword', 'word')
  game.send({ type: 'choose_path', checkpointId: 'choose-the-flavour', nodeId: 'route', choiceId: 'spicy' })
  game.send({ type: 'submit_puzzle', checkpointId: 'choose-the-flavour', nodeId: 'spicy', expectedRevision: 0, value: { optionId: 'chilli' } })
  game.next('choose-the-flavour', 'word')
  const finaleView = getPlayerView(hunt, game.state, now)
  assert.equal(finaleView.hunt.settings?.completionMessage, undefined)
  assert.equal(JSON.stringify(finaleView).includes(campaignPhrase), false)
  game.send({ type: 'submit_puzzle', checkpointId: 'campaign-phrase', nodeId: 'puzzle', expectedRevision: 0, value: { order: ['good', 'food', 'turns', 'strangers', 'into', 'a', 'team'] } })
  assert.equal(game.state.status, 'completed')
  assert.equal(game.state.score, 215)
  assert.equal(game.state.ledger.filter(entry => entry.kind === 'checkpoint_completed').length, 8)
  assert.equal(game.state.ledger.filter(entry => entry.kind === 'time_bonus').length, 8)
  const view = getPlayerView(hunt, game.state, now)
  assert.ok(view.hunt.settings?.completionMessage?.includes(campaignPhrase))
  assert.equal(view.stages?.length, 8)
  assert.equal(view.stages?.find(stage => stage.id === 'name-the-snack')?.steps.find(step => step.id === 'answer')?.response, 'Frankie, roll, or wrap')
  assert.ok(view.stages?.flatMap(stage => stage.steps).some(step => step.text.includes('STRANGERS')))
})

test('showcase vector assets exist locally and require no image or vision service', async () => {
  const urls = new Set(JSON.stringify([exampleHunt, ...huntTemplates]).match(/\/v2\/demo\/[A-Za-z0-9-]+\.svg/g) ?? [])
  assert.ok(urls.size >= 8)
  for (const url of urls) {
    const asset = await readFile(new URL(`../public${url}`, import.meta.url), 'utf8')
    assert.ok(asset.startsWith('<svg')); assert.equal(/<script|onload=|<foreignObject|href="https?:/i.test(asset), false)
  }
})

test('Frankie photo puzzle assets are local optimized images', async () => {
  for (const name of ['frankie-puzzle-source.webp', ...Array.from({ length: 9 }, (_, index) => `frankie-jigsaw-${index + 1}.webp`)]) {
    const asset = await readFile(new URL(`../public/v2/demo/${name}`, import.meta.url))
    assert.ok(asset.length > 1000, name)
    assert.equal(asset.subarray(8, 12).toString(), 'WEBP', name)
  }
})
