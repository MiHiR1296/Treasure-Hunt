import test from 'node:test'
import assert from 'node:assert/strict'
import { containsWord, sudokuSolutionCount } from '../lib/engine/puzzles/helpers'
import { generatePuzzles, parsePuzzleGenerationInput } from '../lib/engine/puzzles/generator'
import { initialPuzzleState, publicPuzzle, updatePuzzle, validatePuzzle } from '../lib/engine/puzzles'
import { puzzleGenerationInput, puzzleGenerationKey, selectGeneratedPuzzle } from '../components/v2/builder/puzzleGeneratorModel'

const learningWords = ['IMAGINATION', 'VOCABULARY', 'NOTEBOOK', 'LESSON', 'STUDY', 'MENTOR', 'HISTORY', 'FICTION', 'POETRY', 'REFERENCE', 'CHAPTER', 'ARCHIVE']

test('word-search generator places every requested word, preserves its continuation/reward settings, and is reproducible from its seed', async () => {
  const input = { type: 'word_search' as const, rows: 12, columns: 12, words: learningWords, minimumWords: 6, bonusPerExtraWord: 2, difficulty: 'hard' as const, variants: 4, seed: 'lokgram-checkpoint-two' }
  const generated = await generatePuzzles(input)
  assert.deepEqual(generated, await generatePuzzles(input))
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

test('word-search generator supports every direction level without changing scoring settings', async () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const [candidate] = await generatePuzzles({ type: 'word_search', rows: 10, columns: 10, words: ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'OMEGA'], minimumWords: 3, bonusPerExtraWord: 4, difficulty, seed: `word-${difficulty}` })
    assert.equal(candidate.puzzle.type, 'word_search')
    if (candidate.puzzle.type !== 'word_search') continue
    assert.deepEqual(validatePuzzle(candidate.puzzle), [])
    assert.equal(candidate.puzzle.minimumWords, 3)
    assert.equal(candidate.puzzle.bonusPerExtraWord, 4)
  }
})

test('choosing a generated word-search layout retains the organiser continuation and reward settings', () => {
  const grid = [['C', 'A', 'T', 'X'], ['D', 'O', 'G', 'X'], ['O', 'W', 'L', 'X'], ['E', 'M', 'U', 'X']]
  const current = {
    type: 'word_search' as const,
    grid,
    words: ['CAT', 'DOG', 'OWL', 'EMU'],
    minimumWords: 4,
    bonusPerExtraWord: 2,
  }
  const generated = {
    type: 'word_search' as const,
    grid,
    words: ['CAT', 'DOG', 'OWL', 'EMU'],
  }
  assert.deepEqual(selectGeneratedPuzzle(current, generated), {
    ...generated,
    minimumWords: 4,
    bonusPerExtraWord: 2,
  })
  assert.equal(selectGeneratedPuzzle({ ...current, minimumWords: 5 }, generated), null)
})

test('a candidate becomes ineligible when words or progress rules change after generation starts', () => {
  const settings = { rows: 8, columns: 8, size: 9 as const, difficulty: 'medium' as const, variants: 4, seed: 'candidate-check' }
  const before = puzzleGenerationInput({ type: 'word_search', grid: [['C', 'A', 'T', 'X'], ['D', 'O', 'G', 'X'], ['O', 'W', 'L', 'X'], ['E', 'M', 'U', 'X']], words: ['CAT', 'DOG', 'OWL', 'EMU'], minimumWords: 4, bonusPerExtraWord: 2 }, settings)
  const after = puzzleGenerationInput({ type: 'word_search', grid: [['C', 'A', 'T', 'X'], ['D', 'O', 'G', 'X'], ['O', 'W', 'L', 'X'], ['E', 'M', 'U', 'X']], words: ['CAT', 'DOG', 'OWL', 'EMU', 'ANT'], minimumWords: 5, bonusPerExtraWord: 2 }, settings)
  assert.notEqual(puzzleGenerationKey(before), puzzleGenerationKey(after))
})

test('word-search generation requests carry scoring settings through the API parser', async () => {
  const parsed = parsePuzzleGenerationInput({
    type: 'word_search', rows: 8, columns: 8, words: ['ALPHA', 'BRAVO'], minimumWords: 1, bonusPerExtraWord: 7,
    difficulty: 'medium', variants: 1, seed: 'request-settings',
  })
  assert.equal(parsed.type, 'word_search')
  if (parsed.type !== 'word_search') return
  assert.equal(parsed.minimumWords, 1)
  assert.equal(parsed.bonusPerExtraWord, 7)
  const [candidate] = await generatePuzzles(parsed)
  assert.equal(candidate.puzzle.type, 'word_search')
  if (candidate.puzzle.type !== 'word_search') return
  assert.equal(candidate.puzzle.minimumWords, 1)
  assert.equal(candidate.puzzle.bonusPerExtraWord, 7)
})

test('Sudoku generator supports every offered size and difficulty with exactly one solution', async () => {
  for (const size of [4, 6, 9] as const) for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const [candidate] = await generatePuzzles({ type: 'sudoku', size, difficulty, seed: `sudoku-${size}-${difficulty}` })
    assert.equal(candidate.puzzle.type, 'sudoku')
    assert.equal(candidate.answerKey.type, 'sudoku')
    if (candidate.puzzle.type !== 'sudoku' || candidate.answerKey.type !== 'sudoku') continue
    assert.deepEqual(validatePuzzle(candidate.puzzle), [])
    assert.equal(sudokuSolutionCount(candidate.puzzle.givens, size, 2, 1_500_000), 1)
    assert.equal(updatePuzzle(candidate.puzzle, initialPuzzleState(candidate.puzzle), { grid: candidate.answerKey.solution }).completed, true)
    assert.ok(!JSON.stringify(publicPuzzle(candidate.puzzle)).includes(JSON.stringify(candidate.answerKey.solution)))
  }
})

test('crossword generator places immediately intersecting answers into a valid connected layout and preserves answers privately', async () => {
  const [candidate] = await generatePuzzles({
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

test('crossword generator permits a word that becomes placeable only after a bridge word', async () => {
  const entries = [
    { id: 'planet', clue: 'A world that orbits a star', answer: 'PLANET' },
    { id: 'tiger', clue: 'A striped big cat', answer: 'TIGER' },
    { id: 'rug', clue: 'A floor covering', answer: 'RUG' },
  ]
  const generated = await generatePuzzles({ type: 'crossword', rows: 9, columns: 9, entries, variants: 4, seed: 'planet-tiger-rug' })
  assert.equal(generated.length, 4)
  for (const candidate of generated) {
    assert.equal(candidate.puzzle.type, 'crossword')
    if (candidate.puzzle.type !== 'crossword') continue
    assert.deepEqual(validatePuzzle(candidate.puzzle), [])
    assert.deepEqual(new Set(candidate.puzzle.entries.map(entry => entry.answer)), new Set(entries.map(entry => entry.answer)))
    assert.equal(candidate.metrics.detail, '3 answers · 2 shared-letter crossings')
  }
})

test('crossword generator explores edge starts on square and rectangular boards', async () => {
  const entries = [
    { id: 'elephant', clue: 'A very large animal with a trunk', answer: 'ELEPHANT' },
    { id: 'excuses', clue: 'Reasons offered to avoid blame', answer: 'EXCUSES' },
  ]
  for (const [rows, columns] of [[8, 8], [9, 8]] as const) {
    const generated = await generatePuzzles({ type: 'crossword', rows, columns, entries, variants: 4, seed: `edge-${rows}-${columns}` })
    assert.equal(generated.length, 4)
    for (const candidate of generated) {
      assert.equal(candidate.puzzle.type, 'crossword')
      if (candidate.puzzle.type !== 'crossword') continue
      assert.deepEqual(validatePuzzle(candidate.puzzle), [])
      if (rows === 8 && columns === 8) assert.ok(candidate.puzzle.entries.some(entry => entry.row === 0 || entry.column === 0 || (entry.direction === 'across' ? entry.row === rows - 1 : entry.column === columns - 1)))
    }
  }
})

test('crowded word searches fail within a shared generation budget and yield to concurrent work', async () => {
  const input = {
    type: 'word_search' as const, rows: 8, columns: 8, difficulty: 'hard' as const, seed: 'deep-natural',
    words: 'PLANET TIGER FOREST RIVER SCHOOL CLASS BOOK PAPER PENCIL LEARN FRIEND TEAM BRAIN LOGIC STUDY LESSON MENTOR READER WORD STORY POETRY AUTHOR NOVEL MUSIC TRAVEL PUZZLE SECRET HIDDEN CLUE PRIZE'.split(' '),
  }
  const started = performance.now()
  const generation = generatePuzzles(input)
  const playerRequest = new Promise(resolve => setTimeout(() => resolve('player request'), 0))
  assert.equal(await Promise.race([generation.then(() => 'generation', () => 'generation'), playerRequest]), 'player request')
  await assert.rejects(generation, /taking too long to generate safely/)
  assert.ok(performance.now() - started < 2_500)
})

test('maximal crowded word-search input rejects before the organiser timeout', async () => {
  const started = performance.now()
  await assert.rejects(generatePuzzles({
    type: 'word_search', rows: 25, columns: 25, difficulty: 'hard', seed: 'deep-tight',
    words: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => letter.repeat(25)),
  }), /taking too long to generate safely/)
  assert.ok(performance.now() - started < 2_500)
})

test('generators reject layouts that cannot meet their stated constraints', async () => {
  await assert.rejects(generatePuzzles({ type: 'word_search', rows: 4, columns: 4, words: ['TOOLONG'], difficulty: 'easy', seed: 'no-fit' }))
  await assert.rejects(generatePuzzles({ type: 'word_search', rows: 8, columns: 8, words: ['VALID'], minimumWords: 2, difficulty: 'easy', seed: 'invalid-threshold' }))
  await assert.rejects(generatePuzzles({ type: 'word_search', rows: 8, columns: 8, words: ['VALID'], bonusPerExtraWord: 101, difficulty: 'easy', seed: 'invalid-bonus' }))
  await assert.rejects(generatePuzzles({ type: 'crossword', rows: 8, columns: 8, entries: [
    { id: 'one', clue: 'First', answer: 'ABC' }, { id: 'two', clue: 'Second', answer: 'DEF' },
  ], seed: 'no-crossing' }))
})
