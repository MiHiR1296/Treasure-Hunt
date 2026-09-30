import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { lokgramPilotHunt } from '../lib/engine/lokgram'
import { validateHunt } from '../lib/engine/validation'

test('Lokgram pilot template is a valid editable hunt definition', () => {
  assert.equal(lokgramPilotHunt.checkpoints.length, 9)
  assert.deepEqual(validateHunt(lokgramPilotHunt), [])
})

test('Lokgram word-search variants remain equivalent and valid', () => {
  const wordSearchNodes = lokgramPilotHunt.checkpoints[1].flow.nodes.filter(node => node.type === 'puzzle')
  assert.equal(wordSearchNodes.length, 4)
  assert.deepEqual(wordSearchNodes.map(node => node.puzzle.type), ['word_search', 'word_search', 'word_search', 'word_search'])
  assert.deepEqual(wordSearchNodes.map(node => node.puzzle.type === 'word_search' ? node.puzzle.words.length : 0), [6, 6, 6, 6])
})

test('Lokgram uses unified clue-plus-verification tasks and the threshold quiz', () => {
  const mango = lokgramPilotHunt.checkpoints[0].flow.nodes.find(node => node.id === 'arrival')
  assert.equal(mango?.type, 'verify_gps')
  if (mango?.type === 'verify_gps') assert.match(mango.clue ?? '', /leafy outdoor space/)
  const quiz = lokgramPilotHunt.checkpoints[2].flow.nodes.find(node => node.id === 'quiz')
  assert.equal(quiz?.type, 'puzzle')
  if (quiz?.type === 'puzzle') {
    assert.equal(quiz.puzzle.type, 'quiz')
    if (quiz.puzzle.type === 'quiz') {
      assert.equal(quiz.puzzle.questions.length, 10)
      assert.equal(quiz.puzzle.minimumCorrect, 3)
      assert.ok(quiz.puzzle.questions.every(question => question.skipPenalty === undefined))
    }
  }
})

test('Lokgram export stays importable with its public settings and visual routes', () => {
  const exported = JSON.parse(fs.readFileSync(new URL('../Hunts_V2/lokgram-pilot.json', import.meta.url), 'utf8'))
  assert.deepEqual(validateHunt(exported), [])
  assert.deepEqual(exported.settings, lokgramPilotHunt.settings)
  assert.deepEqual(exported.theme, lokgramPilotHunt.theme)
  assert.deepEqual(exported.checkpoints.map((checkpoint: { id: string }) => checkpoint.id), lokgramPilotHunt.checkpoints.map(checkpoint => checkpoint.id))
})

test('Lokgram has four balanced crossword variants with targeted clue hints', () => {
  const crossword = lokgramPilotHunt.checkpoints[5]
  const puzzleNodes = crossword.flow.nodes.filter(node => node.type === 'puzzle')
  assert.equal(puzzleNodes.length, 4)
  assert.ok(puzzleNodes.every(node => node.type === 'puzzle' && node.puzzle.type === 'crossword' && node.puzzle.entries.length === 6))
  assert.equal(crossword.hints.filter(hint => hint.relevance?.puzzleItemId).length, 48)
  assert.ok(crossword.hints.every(hint => hint.relevance?.nodeId ? ['variant-a', 'variant-b', 'variant-c', 'variant-d'].includes(hint.relevance.nodeId) : true))
})
