import test from 'node:test'
import assert from 'node:assert/strict'
import { containsWord, sudokuSolutionCount } from '../lib/engine/puzzles/helpers'
import { generatePuzzles, parsePuzzleGenerationInput } from '../lib/engine/puzzles/generator'
import { initialPuzzleState, publicPuzzle, updatePuzzle, validatePuzzle } from '../lib/engine/puzzles'
import { selectGeneratedPuzzle } from '../components/v2/builder/puzzleGeneratorModel'

const learningWords = ['IMAGINATION', 'VOCABULARY', 'NOTEBOOK', 'LESSON', 'STUDY', 'MENTOR', 'HISTORY', 'FICTION', 'POETRY', 'REFERENCE', 'CHAPTER', 'ARCHIVE']

test('word-search generator places every requested word, preserves its continuation/reward settings, and is reproducible from its seed', () => {
  const input = { type: 'word_search' as const, rows: 12, columns: 12, words: learningWords, minimumWords: 6, bonusPerExtraWord: 2, difficulty: 'hard' as const, variants: 4, seed: 'lokgram-checkpoint-two' }
  const generated = generatePuzzles(input)
  assert.deepEqual(generated, generatePuzzles(input))
  assert.equal(generated.length, 4)
  assert.equal(new Set(generated.map(item => item.seed)).size, 4)
  for (const candidate of generated) {
    assert.equal(candidate.puzzle.type, 'word_search')
    assert.equal(candidate.answerKey.type, 'word_search')
    if (candidate.puzzle.type !== 'word_search') continue
    const puzzle = candidate.puzzle
    assert.deepEqual(validatePuzzle(puzzle), [])
    assert.equal(puzzle.minimumWords, 6)
    assert.equal(puzzle.bonusPerExtraWord, 2)
    assert.ok(puzzle.words.every(target => containsWord(puzzle.grid, target)))
    if (candidate.answerKey.type !== 'word_search') continue
    assert.equal(candidate.answerKey.paths.length, learningWords.length)
    for (const path of candidate.answerKey.paths) assert.equal(path.cells.map(cell => puzzle.grid[cell.row][cell.column]).join(''), path.word)
  }
})

test('word-search generator supports every direction level without changing scoring settings', () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const [candidate] = generatePuzzles({ type: 'word_search', rows: 10, columns: 10, words: ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'OMEGA'], minimumWords: 3, bonusPerExtraWord: 4, difficulty, seed: `word-${difficulty}` })
    assert.equal(candidate.puzzle.type, 'word_search')
    if (candidate.puzzle.type !== 'word_search') continue
    assert.deepEqual(validatePuzzle(candidate.puzzle), [])
    assert.equal(candidate.puzzle.minimumWords, 3)
    assert.equal(candidate.puzzle.bonusPerExtraWord, 4)
  }
})

test('choosing a generated word-search layout retains the organiser continuation and reward settings', () => {
  const current = {
    type: 'word_search' as const,
    grid: [['O', 'L', 'D'], ['G', 'R', 'I'], ['D', 'X', 'X']],
    words: ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT'],
    minimumWords: 6,
    bonusPerExtraWord: 2,
  }
  const generated = {
    type: 'word_search' as const,
    grid: [['N', 'E', 'W'], ['G', 'R', 'I'], ['D', 'X', 'X']],
    words: ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET', 'KILO', 'LIMA'],
  }
  assert.deepEqual(selectGeneratedPuzzle(current, generated), {
    ...generated,
    minimumWords: 6,
    bonusPerExtraWord: 2,
  })
})

test('word-search generation requests carry scoring settings through the API parser', () => {
  const parsed = parsePuzzleGenerationInput({
    type: 'word_search', rows: 8, columns: 8, words: ['ALPHA', 'BRAVO'], minimumWords: 1, bonusPerExtraWord: 7,
    difficulty: 'medium', variants: 1, seed: 'request-settings',
  })
  assert.equal(parsed.type, 'word_search')
  if (parsed.type !== 'word_search') return
  assert.equal(parsed.minimumWords, 1)
  assert.equal(parsed.bonusPerExtraWord, 7)
  const [candidate] = generatePuzzles(parsed)
  assert.equal(candidate.puzzle.type, 'word_search')
  if (candidate.puzzle.type !== 'word_search') return
  assert.equal(candidate.puzzle.minimumWords, 1)
  assert.equal(candidate.puzzle.bonusPerExtraWord, 7)
})

test('Sudoku generator supports every offered size and difficulty with exactly one solution', () => {
  for (const size of [4, 6, 9] as const) for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const [candidate] = generatePuzzles({ type: 'sudoku', size, difficulty, seed: `sudoku-${size}-${difficulty}` })
    assert.equal(candidate.puzzle.type, 'sudoku')
    assert.equal(candidate.answerKey.type, 'sudoku')
    if (candidate.puzzle.type !== 'sudoku' || candidate.answerKey.type !== 'sudoku') continue
    assert.deepEqual(validatePuzzle(candidate.puzzle), [])
    assert.equal(sudokuSolutionCount(candidate.puzzle.givens, size, 2, 1_500_000), 1)
    assert.equal(updatePuzzle(candidate.puzzle, initialPuzzleState(candidate.puzzle), { grid: candidate.answerKey.solution }).completed, true)
    assert.ok(!JSON.stringify(publicPuzzle(candidate.puzzle)).includes(JSON.stringify(candidate.answerKey.solution)))
  }
})

test('crossword generator places immediately intersecting answers into a valid connected layout and preserves answers privately', () => {
  const [candidate] = generatePuzzles({
    type: 'crossword', rows: 10, columns: 10, seed: 'connected-crossword', entries: [
      { id: 'care', clue: 'Concern for others', answer: 'CARE' },
      { id: 'race', clue: 'A contest of speed', answer: 'RACE' },
      { id: 'area', clue: 'A space or region', answer: 'AREA' },
    ],
  })
  assert.equal(candidate.puzzle.type, 'crossword')
  assert.equal(candidate.answerKey.type, 'crossword')
  if (candidate.puzzle.type !== 'crossword' || candidate.answerKey.type !== 'crossword') return
  assert.deepEqual(validatePuzzle(candidate.puzzle), [])
  assert.equal(candidate.puzzle.entries.length, 3)
  assert.equal(candidate.metrics.detail, '3 answers · 2 shared-letter crossings')
  const projected = JSON.stringify(publicPuzzle(candidate.puzzle))
  for (const entry of candidate.answerKey.entries) assert.ok(!projected.includes(entry.answer))
})

test('crossword generator permits a word that becomes placeable only after a bridge word', () => {
  const entries = [
    { id: 'planet', clue: 'A world that orbits a star', answer: 'PLANET' },
    { id: 'tiger', clue: 'A striped big cat', answer: 'TIGER' },
    { id: 'rug', clue: 'A floor covering', answer: 'RUG' },
  ]
  const generated = generatePuzzles({ type: 'crossword', rows: 9, columns: 9, entries, variants: 4, seed: 'planet-tiger-rug' })
  assert.equal(generated.length, 4)
  for (const candidate of generated) {
    assert.equal(candidate.puzzle.type, 'crossword')
    if (candidate.puzzle.type !== 'crossword') continue
    assert.deepEqual(validatePuzzle(candidate.puzzle), [])
    assert.deepEqual(new Set(candidate.puzzle.entries.map(entry => entry.answer)), new Set(entries.map(entry => entry.answer)))
    assert.equal(candidate.metrics.detail, '3 answers · 2 shared-letter crossings')
  }
})

test('generators reject layouts that cannot meet their stated constraints', () => {
  assert.throws(() => generatePuzzles({ type: 'word_search', rows: 4, columns: 4, words: ['TOOLONG'], difficulty: 'easy', seed: 'no-fit' }))
  assert.throws(() => generatePuzzles({ type: 'word_search', rows: 8, columns: 8, words: ['VALID'], minimumWords: 2, difficulty: 'easy', seed: 'invalid-threshold' }))
  assert.throws(() => generatePuzzles({ type: 'word_search', rows: 8, columns: 8, words: ['VALID'], bonusPerExtraWord: 101, difficulty: 'easy', seed: 'invalid-bonus' }))
  assert.throws(() => generatePuzzles({ type: 'crossword', rows: 8, columns: 8, entries: [
    { id: 'one', clue: 'First', answer: 'ABC' }, { id: 'two', clue: 'Second', answer: 'DEF' },
  ], seed: 'no-crossing' }))
})
