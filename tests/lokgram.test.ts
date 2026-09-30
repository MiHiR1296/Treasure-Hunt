import test from 'node:test'
import assert from 'node:assert/strict'
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
