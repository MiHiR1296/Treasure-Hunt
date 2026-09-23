import test from 'node:test'
import assert from 'node:assert/strict'
import { initialPuzzleState, publicPuzzle, PuzzleError, updatePuzzle, validatePuzzle, type PuzzleDefinition, type PuzzleState } from '../lib/engine/puzzles'

const fixtures: Record<PuzzleDefinition['type'], PuzzleDefinition> = {
  jigsaw: { type: 'jigsaw', rows: 2, columns: 2, pieces: ['sky', 'river', 'stone', 'leaf'].map(id => ({ id, imageUrl: `/tiles/${id}.png` })), solution: ['river', 'stone', 'leaf', 'sky'] },
  sudoku: { type: 'sudoku', size: 4, givens: [[1, 0, 0, 4], [0, 4, 1, 0], [0, 1, 4, 0], [4, 0, 0, 1]] },
  word_search: { type: 'word_search', grid: [['C', 'A', 'T'], ['X', 'O', 'X'], ['D', 'O', 'G']], words: ['cat', 'dog'] },
  crossword: { type: 'crossword', rows: 3, columns: 3, entries: [{ id: 'across', clue: 'A pet that purrs', answer: 'CAT', row: 0, column: 0, direction: 'across' }, { id: 'down', clue: 'A vehicle', answer: 'CAR', row: 0, column: 0, direction: 'down' }] },
  rotation: { type: 'rotation', columns: 1, tiles: [{ id: 'tile', imageUrl: '/tiles/turned.png', correctRotation: 90 }] },
  text: { type: 'text', prompt: 'Enter the words you collected.', answers: ['secret answer'] },
  multiple_choice: { type: 'multiple_choice', prompt: 'Choose the daylight star.', options: [{ id: 'sun', label: 'Sun' }, { id: 'moon', label: 'Moon' }], correctOptionId: 'sun' },
  matching: { type: 'matching', left: [{ id: 'sun', label: 'Sun' }, { id: 'moon', label: 'Moon' }], right: [{ id: 'day', label: 'Day' }, { id: 'night', label: 'Night' }], solution: [{ leftId: 'sun', rightId: 'day' }, { leftId: 'moon', rightId: 'night' }] },
  sequence: { type: 'sequence', items: [{ id: 'dawn', label: 'Dawn' }, { id: 'noon', label: 'Noon' }, { id: 'dusk', label: 'Dusk' }], solution: ['dawn', 'noon', 'dusk'] },
}
const sudokuSolution = [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]]
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const invalid = (error: unknown) => error instanceof PuzzleError && error.code === 'invalid_submission'
function solve(definition: PuzzleDefinition, submission: unknown) { return updatePuzzle(definition, initialPuzzleState(definition), submission) }

test('all nine modules validate, initialize serializable state, and project public definitions', () => {
  for (const definition of Object.values(fixtures)) {
    assert.deepEqual(validatePuzzle(definition), [], definition.type)
    assert.equal(initialPuzzleState(definition).type, definition.type)
    assert.equal(publicPuzzle(definition).type, definition.type)
    assert.deepEqual(clone(initialPuzzleState(definition)), initialPuzzleState(definition))
  }
})

test('jigsaw verifies tile identity and arrangement on the server', () => {
  const definition = fixtures.jigsaw
  if (definition.type !== 'jigsaw') throw new Error('Fixture')
  const initial = initialPuzzleState(definition)
  assert.notDeepEqual(initial, { type: 'jigsaw', order: definition.solution })
  assert.equal(solve(definition, { order: definition.solution }).completed, true)
  assert.equal(solve(definition, { order: [...definition.solution].reverse() }).completed, false)
  assert.throws(() => solve(definition, { order: ['river', 'river', 'leaf', 'sky'] }), invalid)
  assert.throws(() => solve(definition, { order: ['river', 'stone', 'leaf', 'other'] }), invalid)
  assert.throws(() => solve(definition, { completed: true }), invalid)
})

test('Sudoku protects givens, permits correction, and accepts valid solved constraints', () => {
  const definition = fixtures.sudoku
  const solved = solve(definition, { grid: sudokuSolution })
  assert.equal(solved.completed, true)
  const partial = clone(sudokuSolution); partial[0][1] = 0
  assert.equal(solve(definition, { grid: partial }).completed, false)
  const mistaken = clone(sudokuSolution); mistaken[0][1] = 3
  const result = solve(definition, { grid: mistaken })
  assert.equal(result.completed, false)
  assert.equal(updatePuzzle(definition, result.state, { grid: sudokuSolution }).completed, true)
  const tamperedGiven = clone(sudokuSolution); tamperedGiven[0][0] = 2
  assert.throws(() => solve(definition, { grid: tamperedGiven }), invalid)
  const outsideRange = clone(sudokuSolution); outsideRange[0][1] = 5
  assert.throws(() => solve(definition, { grid: outsideRange }), invalid)
  assert.throws(() => solve(definition, { grid: [[1]] }), invalid)
})

test('standard 9×9 Sudoku is supported without sending a private answer grid', () => {
  const solution = Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, column) => (row * 3 + Math.floor(row / 3) + column) % 9 + 1))
  const givens = clone(solution); givens[8][8] = 0
  const definition: PuzzleDefinition = { type: 'sudoku', size: 9, givens }
  assert.deepEqual(validatePuzzle(definition), [])
  assert.equal(solve(definition, { grid: solution }).completed, true)
  assert.deepEqual(publicPuzzle(definition), { type: 'sudoku', size: 9, givens })
})

test('word search validates contiguous paths, restores discoveries, and deduplicates finds', () => {
  const definition = fixtures.word_search
  let state = initialPuzzleState(definition)
  const cat = { path: [{ row: 0, column: 0 }, { row: 0, column: 1 }, { row: 0, column: 2 }] }
  const first = updatePuzzle(definition, state, cat)
  assert.equal(first.completed, false)
  state = clone(first.state)
  const repeated = updatePuzzle(definition, state, cat)
  assert.deepEqual(repeated.state, { type: 'word_search', foundWords: ['CAT'] })
  const finish = updatePuzzle(definition, repeated.state, { path: [{ row: 2, column: 2 }, { row: 2, column: 1 }, { row: 2, column: 0 }] })
  assert.equal(finish.completed, true)
  assert.throws(() => updatePuzzle(definition, state, { foundWords: ['CAT', 'DOG'] }), invalid)
  assert.throws(() => updatePuzzle(definition, state, { path: [{ row: 0, column: 0 }, { row: 0, column: 2 }] }), invalid)
  assert.throws(() => updatePuzzle(definition, state, { path: [{ row: 0, column: 0 }, { row: 1, column: 1 }, { row: 1, column: 2 }] }), invalid)
  assert.deepEqual(solve(definition, { path: [{ row: 1, column: 0 }, { row: 1, column: 1 }, { row: 1, column: 2 }] }).state, { type: 'word_search', foundWords: [] })
})

test('word search can unlock early and rewards only newly found extra words', () => {
  const base = fixtures.word_search
  if (base.type !== 'word_search') throw new Error('Fixture')
  const definition: PuzzleDefinition = { ...base, minimumWords: 1, bonusPerExtraWord: 3 }
  const cat = { path: [{ row: 0, column: 0 }, { row: 0, column: 1 }, { row: 0, column: 2 }] }
  const dog = { path: [{ row: 2, column: 0 }, { row: 2, column: 1 }, { row: 2, column: 2 }] }
  assert.throws(() => solve(definition, { finish: true }), invalid)
  const first = solve(definition, cat)
  assert.equal(first.completed, false, 'meeting the minimum leaves the bonus hunt open')
  assert.deepEqual(first.rewards, undefined)
  assert.equal(updatePuzzle(definition, first.state, { finish: true }).completed, true)
  const repeated = updatePuzzle(definition, first.state, cat)
  assert.deepEqual(repeated.rewards, undefined)
  const extra = updatePuzzle(definition, repeated.state, dog)
  assert.equal(extra.completed, true)
  assert.deepEqual(extra.rewards, [{ id: 'word-search:extra:1', amount: 3, label: 'Extra ingredient: DOG' }])
})

test('crossword keeps answers private and checks letters and black squares', () => {
  const definition = fixtures.crossword
  const correct = [['C', 'A', 'T'], ['A', '', ''], ['R', '', '']]
  assert.equal(solve(definition, { grid: correct }).completed, true)
  const wrong = clone(correct); wrong[0][1] = 'B'
  assert.equal(solve(definition, { grid: wrong }).completed, false)
  const blocked = clone(correct); blocked[1][1] = 'X'
  assert.throws(() => solve(definition, { grid: blocked }), invalid)
  const projection = publicPuzzle(definition)
  assert.ok(!JSON.stringify(projection).includes('CAT'))
  assert.ok(!JSON.stringify(projection).includes('CAR'))
  if (projection.type === 'crossword') assert.equal(projection.entries[0].length, 3)
})

test('word search can distinguish two target words that reverse each other', () => {
  const definition: PuzzleDefinition = { type: 'word_search', grid: [['S', 'T', 'O', 'P'], ['A', 'B', 'C', 'D']], words: ['STOP', 'POTS'] }
  let state = initialPuzzleState(definition)
  state = updatePuzzle(definition, state, { path: [0, 1, 2, 3].map(column => ({ row: 0, column })) }).state
  const result = updatePuzzle(definition, state, { path: [3, 2, 1, 0].map(column => ({ row: 0, column })) })
  assert.equal(result.completed, true)
})

test('rotation verifies every configured orientation and rejects arbitrary angles', () => {
  const definition = fixtures.rotation
  assert.equal(solve(definition, { rotations: { tile: 90 } }).completed, true)
  assert.equal(solve(definition, { rotations: { tile: 180 } }).completed, false)
  assert.throws(() => solve(definition, { rotations: { tile: 45 } }), invalid)
  assert.throws(() => solve(definition, { rotations: { tile: 90, extra: 0 } }), invalid)
  assert.throws(() => solve(definition, { rotations: {} }), invalid)
  assert.ok(!JSON.stringify(publicPuzzle(definition)).includes('correctRotation'))
})

test('text and multiple choice validate submitted answers rather than a completion flag', () => {
  assert.equal(solve(fixtures.text, { value: '  SECRET   ANSWER ' }).completed, true)
  assert.equal(solve(fixtures.text, { value: 'wrong' }).completed, false)
  assert.equal(solve({ type: 'text', prompt: 'Case sensitive', answers: ['A'], caseSensitive: true }, { value: 'a' }).completed, false)
  assert.equal(solve(fixtures.multiple_choice, { optionId: 'sun' }).completed, true)
  assert.equal(solve(fixtures.multiple_choice, { optionId: 'moon' }).completed, false)
  assert.throws(() => solve(fixtures.multiple_choice, { optionId: 'missing' }), invalid)
  assert.throws(() => solve(fixtures.text, { value: 'secret answer', completed: true }), invalid)
})

test('matching validates unique pairs and remains editable until every pair is correct', () => {
  const definition = fixtures.matching
  if (definition.type !== 'matching') throw new Error('Fixture')
  assert.equal(solve(definition, { pairs: definition.solution }).completed, true)
  assert.equal(solve(definition, { pairs: [{ leftId: 'sun', rightId: 'night' }, { leftId: 'moon', rightId: 'day' }] }).completed, false)
  assert.equal(solve(definition, { pairs: [definition.solution[0]] }).completed, false)
  assert.throws(() => solve(definition, { pairs: [{ leftId: 'sun', rightId: 'day' }, { leftId: 'moon', rightId: 'day' }] }), invalid)
  assert.throws(() => solve(definition, { pairs: [{ leftId: 'missing', rightId: 'day' }] }), invalid)
})

test('sequence restores intermediate order and verifies the private target sequence', () => {
  const definition = fixtures.sequence
  if (definition.type !== 'sequence') throw new Error('Fixture')
  const partial = solve(definition, { order: ['dusk', 'noon', 'dawn'] })
  assert.equal(partial.completed, false)
  assert.equal(updatePuzzle(definition, clone(partial.state), { order: definition.solution }).completed, true)
  assert.throws(() => solve(definition, { order: ['dawn', 'dawn', 'noon'] }), invalid)
})

test('public projections and initial states redact answer keys and do not alias definitions', () => {
  for (const definition of Object.values(fixtures)) {
    const before = clone(definition)
    const projection = publicPuzzle(definition)
    const initial = initialPuzzleState(definition)
    for (const secretField of ['"solution"', '"answers"', '"answer"', '"correctOptionId"', '"correctRotation"']) {
      assert.ok(!JSON.stringify(projection).includes(secretField), `${definition.type} leaked ${secretField}`)
      assert.ok(!JSON.stringify(initial).includes(secretField), `${definition.type} initial state leaked ${secretField}`)
    }
    assert.ok(!JSON.stringify(projection).includes('secret answer'))
    assert.deepEqual(definition, before)
  }
  const definition = clone(fixtures.sudoku)
  const initial = initialPuzzleState(definition)
  if (initial.type !== 'sudoku' || definition.type !== 'sudoku') throw new Error('Fixture')
  initial.grid[0][0] = 9
  assert.equal(definition.givens[0][0], 1)
})

test('malformed configurations, impossible boards, unsafe assets, and unsupported modules fail closed', () => {
  const invalidDefinitions: unknown[] = [
    null, { type: 'custom' }, { ...fixtures.text, unsupported: true },
    { type: 'text', prompt: 'Question', answers: [] },
    { type: 'sudoku', size: 4, givens: [[1, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    { type: 'sudoku', size: 4, givens: sudokuSolution },
    { type: 'word_search', grid: [['A', 'B'], ['C', 'D']], words: ['MISSING'] },
    { type: 'word_search', grid: [['A', 'B'], ['C']], words: ['AB'] },
    { type: 'word_search', grid: [['A', 'B'], ['C', 'D']], words: ['AB', 'ab'] },
    { type: 'word_search', grid: [['A', 'B'], ['C', 'D']], words: ['AB'], minimumWords: 2 },
    { type: 'word_search', grid: [['A', 'B'], ['C', 'D']], words: ['AB'], bonusPerExtraWord: 101 },
    { type: 'crossword', rows: 2, columns: 2, entries: [{ id: 'long', clue: 'Long', answer: 'LONG', row: 0, column: 0, direction: 'across' }] },
    { type: 'crossword', rows: 2, columns: 2, entries: [{ id: 'one', clue: 'One', answer: 'AB', row: 0, column: 0, direction: 'across' }, { id: 'two', clue: 'Two', answer: 'CD', row: 0, column: 0, direction: 'down' }] },
    { type: 'rotation', columns: 1, tiles: [{ id: 'one', imageUrl: 'javascript:alert(1)', correctRotation: 90 }] },
    { type: 'rotation', columns: 1, tiles: [{ id: 'constructor', imageUrl: '/tile.png', correctRotation: 90 }] },
    { type: 'rotation', columns: 1, tiles: [{ id: 'one', imageUrl: '/tile.png', correctRotation: 0 }] },
    { ...fixtures.multiple_choice, correctOptionId: 'missing' },
    { ...fixtures.sequence, solution: ['dawn', 'dawn', 'dusk'] },
    { ...fixtures.matching, solution: [{ leftId: 'sun', rightId: 'day' }, { leftId: 'moon', rightId: 'day' }] },
  ]
  for (const value of invalidDefinitions) assert.ok(validatePuzzle(value).length > 0, JSON.stringify(value))
})

test('updates reject mismatched puzzle state and leave earlier snapshots untouched', () => {
  const definition = fixtures.text
  const state = initialPuzzleState(definition)
  const snapshot = clone(state)
  updatePuzzle(definition, state, { value: 'wrong' })
  assert.deepEqual(state, snapshot)
  assert.throws(() => updatePuzzle(definition, { type: 'sequence', order: [] }, { value: 'secret answer' }), error => error instanceof PuzzleError && error.code === 'invalid_puzzle_state')
  assert.throws(() => updatePuzzle(definition, null as unknown as PuzzleState, {}), error => error instanceof PuzzleError && error.code === 'invalid_puzzle_state')
})
