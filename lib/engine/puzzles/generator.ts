import { EngineError } from '../types'
import { copy, sudokuBoxDimensions, sudokuConsistent, sudokuSolutionCount, word } from './helpers'
import type { Cell, PuzzleDefinition, SudokuSize } from './types'
import { validatePuzzle } from './validation'

export type PuzzleDifficulty = 'easy' | 'medium' | 'hard'
export type PuzzleGenerationInput =
  | { type: 'word_search'; rows: number; columns: number; words: string[]; minimumWords?: number; bonusPerExtraWord?: number; difficulty: PuzzleDifficulty; variants?: number; seed?: string }
  | { type: 'sudoku'; size: SudokuSize; difficulty: PuzzleDifficulty; variants?: number; seed?: string }
  | { type: 'crossword'; rows: number; columns: number; entries: { id: string; clue: string; answer: string }[]; variants?: number; seed?: string }

export interface GeneratedPuzzle {
  puzzle: Extract<PuzzleDefinition, { type: 'word_search' | 'sudoku' | 'crossword' }>
  seed: string
  answerKey: { type: 'word_search'; paths: { word: string; cells: Cell[] }[] }
    | { type: 'sudoku'; solution: number[][] }
    | { type: 'crossword'; entries: { id: string; answer: string; row: number; column: number; direction: 'across' | 'down' }[] }
  metrics: { label: string; detail: string }
}

const directions = {
  easy: [[0, 1], [1, 0]],
  medium: [[0, 1], [1, 0], [1, 1], [1, -1], [0, -1], [-1, 0]],
  hard: [[0, 1], [1, 0], [1, 1], [1, -1], [0, -1], [-1, 0], [-1, -1], [-1, 1]],
} as const

type Random = () => number
type WordPlacement = { row: number; column: number; rowStep: number; columnStep: number; overlap: number }
type CrosswordInput = Extract<PuzzleGenerationInput, { type: 'crossword' }>['entries'][number]
type CrosswordPlacement = CrosswordInput & { row: number; column: number; direction: 'across' | 'down'; crossings: number }
type CrosswordCell = { letter: string; directions: Set<'across' | 'down'> }

function fail(message: string): never { throw new EngineError('invalid_definition', message) }
const GENERATION_TIME_LIMIT_MS = 2_000
const GENERATION_WORK_LIMIT = 300_000
const YIELD_AFTER_WORK = 1_024
const generationLimitMessage = 'This puzzle is taking too long to generate safely. Use fewer entries, a larger grid, or an easier layout and try again.'

/** Shares short CPU slices with player requests and caps one organiser generation request. */
class GenerationBudget {
  private work = 0
  private nextYield = YIELD_AFTER_WORK
  private readonly deadline = performance.now() + GENERATION_TIME_LIMIT_MS

  tick(units = 1): Promise<void> | undefined {
    this.work += units
    if (this.work > GENERATION_WORK_LIMIT || performance.now() > this.deadline) fail(generationLimitMessage)
    if (this.work < this.nextYield) return undefined
    this.nextYield += YIELD_AFTER_WORK
    return new Promise<void>(resolve => setTimeout(resolve, 0)).then(() => {
      if (performance.now() > this.deadline) fail(generationLimitMessage)
    })
  }
}

async function checkpoint(budget: GenerationBudget, units = 1) {
  const pause = budget.tick(units)
  if (pause) await pause
}

function hash(value: string) { let result = 2166136261; for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619); return result >>> 0 }
function randomFor(seed: string): Random { let state = hash(seed) || 1; return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4_294_967_296 } }
function generatedSeed(value: string | undefined) {
  if (value !== undefined) {
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(value)) fail('Use a short seed containing letters, numbers, hyphens, or underscores.')
    return value
  }
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 0xFFFFFF).toString(36)}`
}
function shuffled<T>(items: readonly T[], random: Random) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) { const target = Math.floor(random() * (index + 1)); [result[index], result[target]] = [result[target], result[index]] }
  return result
}
function assertInteger(value: unknown, min: number, max: number, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail(message)
  return value
}
function cleanWords(words: unknown, max = 30): string[] {
  if (!Array.isArray(words) || words.length < 1 || words.length > max) fail(`Enter between 1 and ${max} words.`)
  const result = words.map(value => typeof value === 'string' ? value.trim().toUpperCase() : '')
  if (result.some(value => !word(value))) fail('Words must contain only letters and be at most 40 characters long.')
  if (result.some(value => value.length < 2)) fail('Word-search targets must be at least two letters long.')
  if (new Set(result).size !== result.length) fail('Each word must be unique.')
  return result
}
function variants(value: unknown): number { return value === undefined ? 1 : assertInteger(value, 1, 4, 'Choose between 1 and 4 generated variants.') }
function difficulty(value: unknown): PuzzleDifficulty {
  if (value !== 'easy' && value !== 'medium' && value !== 'hard') fail('Choose easy, medium, or hard difficulty.')
  return value
}

async function wordCandidates(grid: (string | null)[][], rows: number, columns: number, target: string, allowed: readonly (readonly number[])[], budget: GenerationBudget) {
  const candidates: WordPlacement[] = []
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) for (const [rowStep, columnStep] of allowed) {
    await checkpoint(budget)
    const endRow = row + rowStep * (target.length - 1), endColumn = column + columnStep * (target.length - 1)
    if (endRow < 0 || endRow >= rows || endColumn < 0 || endColumn >= columns) continue
    let overlap = 0, conflict = false
    for (let index = 0; index < target.length; index++) {
      await checkpoint(budget)
      const current = grid[row + rowStep * index][column + columnStep * index]
      if (current && current !== target[index]) { conflict = true; break }
      if (current === target[index]) overlap++
    }
    if (!conflict) candidates.push({ row, column, rowStep, columnStep, overlap })
  }
  return candidates
}

async function generateWordSearchOne(input: Extract<PuzzleGenerationInput, { type: 'word_search' }>, seed: string, budget: GenerationBudget): Promise<GeneratedPuzzle> {
  const rows = assertInteger(input.rows, 4, 25, 'Word-search rows must be between 4 and 25.')
  const columns = assertInteger(input.columns, 4, 25, 'Word-search columns must be between 4 and 25.')
  const words = cleanWords(input.words, 50)
  if (words.some(item => item.length > Math.max(rows, columns))) fail('Increase the grid size or remove a word that does not fit.')
  const minimumWords = input.minimumWords === undefined ? undefined : assertInteger(input.minimumWords, 1, words.length, 'Words required to continue must be between 1 and the number of hidden words.')
  const bonusPerExtraWord = input.bonusPerExtraWord === undefined ? undefined : assertInteger(input.bonusPerExtraWord, 0, 100, 'The bonus for each extra word must be between 0 and 100 points.')
  const level = difficulty(input.difficulty), random = randomFor(seed), allowed = directions[level]
  let placed: Map<string, WordPlacement> | null = null
  let resultGrid: (string | null)[][] | null = null
  const ordered = [...words].sort((left, right) => right.length - left.length || left.localeCompare(right))
  for (let restart = 0; restart < 120 && !placed; restart++) {
    await checkpoint(budget)
    const grid = Array.from({ length: rows }, () => Array<string | null>(columns).fill(null))
    const result = new Map<string, WordPlacement>()
    let explored = 0
    const place = async (index: number): Promise<boolean> => {
      await checkpoint(budget)
      if (++explored > 25_000) return false
      if (index === ordered.length) return true
      const target = ordered[index]
      const candidates = (await wordCandidates(grid, rows, columns, target, allowed, budget)).map(candidate => ({ ...candidate, rank: candidate.overlap * 100 + random() * 20 }))
        .sort((left, right) => right.rank - left.rank).slice(0, 72)
      for (const candidate of candidates) {
        await checkpoint(budget, target.length)
        const changed: Cell[] = []
        for (let offset = 0; offset < target.length; offset++) {
          const row = candidate.row + candidate.rowStep * offset, column = candidate.column + candidate.columnStep * offset
          if (!grid[row][column]) { grid[row][column] = target[offset]; changed.push({ row, column }) }
        }
        result.set(target, candidate)
        if (await place(index + 1)) return true
        result.delete(target)
        for (const cell of changed) grid[cell.row][cell.column] = null
      }
      return false
    }
    if (await place(0)) { placed = result; resultGrid = grid }
  }
  if (!placed || !resultGrid) fail('The requested words could not be placed together. Increase the grid size, use fewer words, or choose an easier layout.')
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const grid = resultGrid.map(row => row.map(value => value || alphabet[Math.floor(random() * alphabet.length)]))
  const puzzle = { type: 'word_search' as const, grid, words, ...(minimumWords === undefined ? {} : { minimumWords }), ...(bonusPerExtraWord === undefined ? {} : { bonusPerExtraWord }) }
  const errors = validatePuzzle(puzzle)
  if (errors.length) fail(errors.join(' '))
  return {
    puzzle,
    seed,
    answerKey: { type: 'word_search', paths: words.map(word => {
      const placement = placed!.get(word)!
      return { word, cells: Array.from({ length: word.length }, (_, index) => ({ row: placement.row + placement.rowStep * index, column: placement.column + placement.columnStep * index })) }
    }) },
    metrics: { label: `${rows} × ${columns} ${level} word search`, detail: `${words.length} words · ${allowed.length} permitted directions` },
  }
}

function sudokuCandidates(grid: number[][], row: number, column: number, size: SudokuSize) {
  const box = sudokuBoxDimensions(size)
  const used = new Set([...grid[row], ...grid.map(line => line[column])])
  const startRow = Math.floor(row / box.rows) * box.rows, startColumn = Math.floor(column / box.columns) * box.columns
  for (let r = startRow; r < startRow + box.rows; r++) for (let c = startColumn; c < startColumn + box.columns; c++) used.add(grid[r][c])
  return Array.from({ length: size }, (_, index) => index + 1).filter(value => !used.has(value))
}

function solvedSudoku(size: SudokuSize, random: Random) {
  const grid = Array.from({ length: size }, () => Array<number>(size).fill(0))
  const fill = (): boolean => {
    let best: { row: number; column: number; candidates: number[] } | null = null
    for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
      if (grid[row][column]) continue
      const candidates = sudokuCandidates(grid, row, column, size)
      if (!candidates.length) return false
      if (!best || candidates.length < best.candidates.length) best = { row, column, candidates }
    }
    if (!best) return true
    for (const value of shuffled(best.candidates, random)) {
      grid[best.row][best.column] = value
      if (fill()) return true
      grid[best.row][best.column] = 0
    }
    return false
  }
  if (!fill()) fail('Could not create a complete Sudoku grid.')
  return grid
}

function targetGivens(size: SudokuSize, level: PuzzleDifficulty) {
  const targets: Record<SudokuSize, Record<PuzzleDifficulty, number>> = {
    4: { easy: 11, medium: 8, hard: 6 },
    6: { easy: 24, medium: 18, hard: 14 },
    9: { easy: 40, medium: 32, hard: 26 },
  }
  return targets[size][level]
}

function generateSudokuOne(input: Extract<PuzzleGenerationInput, { type: 'sudoku' }>, seed: string): GeneratedPuzzle {
  if (input.size !== 4 && input.size !== 6 && input.size !== 9) fail('Choose a 4×4, 6×6, or 9×9 Sudoku.')
  const level = difficulty(input.difficulty), random = randomFor(seed), solution = solvedSudoku(input.size, random)
  const givens = copy(solution), target = targetGivens(input.size, level)
  const cells = shuffled(Array.from({ length: input.size * input.size }, (_, index) => index), random)
  for (const cell of cells) {
    if (givens.flat().filter(Boolean).length <= target) break
    const row = Math.floor(cell / input.size), column = cell % input.size, old = givens[row][column]
    givens[row][column] = 0
    if (sudokuSolutionCount(givens, input.size, 2, 1_500_000) !== 1) givens[row][column] = old
  }
  if (!sudokuConsistent(givens, input.size) || sudokuSolutionCount(givens, input.size, 2, 1_500_000) !== 1) fail('Could not create a uniquely solvable Sudoku. Please generate another one.')
  const puzzle = { type: 'sudoku' as const, size: input.size, givens }
  const errors = validatePuzzle(puzzle)
  if (errors.length) fail(errors.join(' '))
  return {
    puzzle,
    seed,
    answerKey: { type: 'sudoku', solution },
    metrics: { label: `${input.size} × ${input.size} ${level} Sudoku`, detail: `${givens.flat().filter(Boolean).length} given numbers · exactly one solution` },
  }
}

function crosswordKey(row: number, column: number) { return `${row}:${column}` }
function cloneCrosswordGrid(grid: Map<string, CrosswordCell>) { return new Map([...grid].map(([key, cell]) => [key, { letter: cell.letter, directions: new Set(cell.directions) }])) }
function crosswordBounds(placement: CrosswordPlacement) {
  const length = placement.answer.length
  return placement.direction === 'across'
    ? { endRow: placement.row, endColumn: placement.column + length - 1 }
    : { endRow: placement.row + length - 1, endColumn: placement.column }
}
async function canPlaceCrossword(grid: Map<string, CrosswordCell>, rows: number, columns: number, placement: CrosswordPlacement, first: boolean, budget: GenerationBudget) {
  await checkpoint(budget)
  const { endRow, endColumn } = crosswordBounds(placement)
  if (placement.row < 0 || placement.column < 0 || endRow >= rows || endColumn >= columns) return false
  const rowStep = placement.direction === 'down' ? 1 : 0, columnStep = placement.direction === 'across' ? 1 : 0
  const before = grid.get(crosswordKey(placement.row - rowStep, placement.column - columnStep))
  const after = grid.get(crosswordKey(endRow + rowStep, endColumn + columnStep))
  if (before || after) return false
  let crossings = 0
  for (let index = 0; index < placement.answer.length; index++) {
    await checkpoint(budget)
    const row = placement.row + rowStep * index, column = placement.column + columnStep * index
    const current = grid.get(crosswordKey(row, column))
    if (current) {
      if (current.letter !== placement.answer[index] || current.directions.has(placement.direction)) return false
      crossings++
      continue
    }
    const perpendicular = placement.direction === 'across' ? [[row - 1, column], [row + 1, column]] : [[row, column - 1], [row, column + 1]]
    if (perpendicular.some(([r, c]) => grid.has(crosswordKey(r, c)))) return false
  }
  return first ? crossings === 0 : crossings > 0
}
function placeCrossword(grid: Map<string, CrosswordCell>, placement: CrosswordPlacement) {
  const result = cloneCrosswordGrid(grid), rowStep = placement.direction === 'down' ? 1 : 0, columnStep = placement.direction === 'across' ? 1 : 0
  for (let index = 0; index < placement.answer.length; index++) {
    const row = placement.row + rowStep * index, column = placement.column + columnStep * index, key = crosswordKey(row, column)
    const current = result.get(key)
    if (current) current.directions.add(placement.direction)
    else result.set(key, { letter: placement.answer[index], directions: new Set([placement.direction]) })
  }
  return result
}
async function crosswordCandidates(entry: CrosswordInput, grid: Map<string, CrosswordCell>, rows: number, columns: number, budget: GenerationBudget) {
  const candidates: CrosswordPlacement[] = []
  for (const [key, cell] of grid) for (const [index, letter] of [...entry.answer].entries()) {
    await checkpoint(budget)
    if (letter !== cell.letter) continue
    const [row, column] = key.split(':').map(Number)
    for (const direction of ['across', 'down'] as const) {
      await checkpoint(budget)
      if (cell.directions.has(direction)) continue
      const placement: CrosswordPlacement = { ...entry, row: row - (direction === 'down' ? index : 0), column: column - (direction === 'across' ? index : 0), direction, crossings: 0 }
      if (await canPlaceCrossword(grid, rows, columns, placement, false, budget)) {
        let crossings = 0
        const rowStep = direction === 'down' ? 1 : 0, columnStep = direction === 'across' ? 1 : 0
        for (let offset = 0; offset < entry.answer.length; offset++) {
          await checkpoint(budget)
          if (grid.has(crosswordKey(placement.row + rowStep * offset, placement.column + columnStep * offset))) crossings++
        }
        candidates.push({ ...placement, crossings })
      }
    }
  }
  return candidates
}
function crosswordEntryInput(entries: unknown): CrosswordInput[] {
  if (!Array.isArray(entries) || entries.length < 2 || entries.length > 30) fail('Enter between 2 and 30 crossword answers before generating a layout.')
  const result = entries.map(item => item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null).map(item => ({
    id: typeof item?.id === 'string' ? item.id : '', clue: typeof item?.clue === 'string' ? item.clue.trim() : '', answer: typeof item?.answer === 'string' ? item.answer.trim().toUpperCase() : '',
  }))
  if (result.some(entry => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(entry.id) || !entry.clue || !word(entry.answer))) fail('Each crossword entry needs a unique ID, a clue, and a letter-only answer.')
  if (new Set(result.map(entry => entry.id)).size !== result.length || new Set(result.map(entry => entry.answer)).size !== result.length) fail('Crossword IDs and answers must be unique.')
  return result
}

async function initialCrosswordPlacements(entry: CrosswordInput, rows: number, columns: number, random: Random, budget: GenerationBudget) {
  const placements: CrosswordPlacement[] = []
  for (const direction of ['across', 'down'] as const) {
    const maxRow = direction === 'down' ? rows - entry.answer.length : rows - 1
    const maxColumn = direction === 'across' ? columns - entry.answer.length : columns - 1
    for (let row = 0; row <= maxRow; row++) for (let column = 0; column <= maxColumn; column++) {
      await checkpoint(budget)
      placements.push({ ...entry, row, column, direction, crossings: 0 })
    }
  }
  return shuffled(placements, random)
}

async function generateCrosswordOne(input: Extract<PuzzleGenerationInput, { type: 'crossword' }>, seed: string, budget: GenerationBudget): Promise<GeneratedPuzzle> {
  const rows = assertInteger(input.rows, 3, 25, 'Crossword rows must be between 3 and 25.'), columns = assertInteger(input.columns, 3, 25, 'Crossword columns must be between 3 and 25.')
  const entries = crosswordEntryInput(input.entries), random = randomFor(seed)
  if (entries.some(entry => entry.answer.length > Math.max(rows, columns))) fail('Increase the crossword size or remove an answer that does not fit.')
  let best: CrosswordPlacement[] | null = null
  for (let restart = 0; restart < 100 && !best; restart++) {
    await checkpoint(budget)
    const ordered = shuffled(entries, random).sort((left, right) => right.answer.length - left.answer.length)
    const first = ordered[0]
    const initialPlacements = await initialCrosswordPlacements(first, rows, columns, random, budget)
    const initial = initialPlacements[restart % initialPlacements.length]
    const solve = async (grid: Map<string, CrosswordCell>, pending: CrosswordInput[], placed: CrosswordPlacement[], searchBudget: { remaining: number }): Promise<CrosswordPlacement[] | null> => {
      await checkpoint(budget)
      if (--searchBudget.remaining < 0) return null
      if (!pending.length) return placed
      // An entry may have no crossing *yet* but become placeable after a bridge word.
      // Only fail when no remaining entry can extend the connected layout at all.
      const options: { entry: CrosswordInput; candidates: CrosswordPlacement[] }[] = []
      for (const entry of pending) {
        const candidates = await crosswordCandidates(entry, grid, rows, columns, budget)
        if (candidates.length) options.push({ entry, candidates })
      }
      options.sort((left, right) => left.candidates.length - right.candidates.length || right.entry.answer.length - left.entry.answer.length)
      if (!options.length) return null
      const selected = options[0]
      const candidates = selected.candidates.map(candidate => ({ ...candidate, rank: candidate.crossings * 100 + random() * 10 })).sort((left, right) => right.rank - left.rank).slice(0, 48)
      for (const candidate of candidates) {
        await checkpoint(budget, candidate.answer.length)
        const solved = await solve(placeCrossword(grid, candidate), pending.filter(entry => entry.id !== selected.entry.id), [...placed, candidate], searchBudget)
        if (solved) return solved
      }
      return null
    }
    if (initial && await canPlaceCrossword(new Map(), rows, columns, initial, true, budget)) best = await solve(placeCrossword(new Map(), initial), ordered.slice(1), [initial], { remaining: 30_000 })
  }
  if (!best) fail('These answers could not form one connected crossword. Try a larger grid or choose words with more shared letters.')
  const puzzle = { type: 'crossword' as const, rows, columns, entries: best.map(({ id, clue, answer, row, column, direction }) => ({ id, clue, answer, row, column, direction })) }
  const errors = validatePuzzle(puzzle)
  if (errors.length) fail(errors.join(' '))
  const crossings = best.reduce((total, entry) => total + entry.crossings, 0)
  return {
    puzzle,
    seed,
    answerKey: { type: 'crossword', entries: best.map(({ id, answer, row, column, direction }) => ({ id, answer, row, column, direction })) },
    metrics: { label: `${rows} × ${columns} connected crossword`, detail: `${best.length} answers · ${crossings} shared-letter crossings` },
  }
}

/** Produces private organizer-only generation previews without monopolising the shared request loop. */
export async function generatePuzzles(input: PuzzleGenerationInput): Promise<GeneratedPuzzle[]> {
  const count = variants(input.variants), baseSeed = generatedSeed(input.seed)
  const budget = new GenerationBudget()
  const generated: GeneratedPuzzle[] = []
  for (let index = 0; index < count; index++) {
    const seed = count === 1 ? baseSeed : `${baseSeed}-${index + 1}`
    switch (input.type) {
      case 'word_search': generated.push(await generateWordSearchOne(input, seed, budget)); break
      case 'sudoku': generated.push(generateSudokuOne(input, seed)); break
      case 'crossword': generated.push(await generateCrosswordOne(input, seed, budget)); break
    }
  }
  return generated
}

export function parsePuzzleGenerationInput(value: unknown): PuzzleGenerationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Choose a puzzle generation setup.')
  const input = value as Record<string, unknown>
  const seed = input.seed === undefined ? undefined : typeof input.seed === 'string' ? input.seed : fail('Use a valid generation seed.')
  const count = input.variants === undefined ? undefined : input.variants
  if (input.type === 'word_search') return { type: 'word_search', rows: input.rows as number, columns: input.columns as number, words: input.words as string[], minimumWords: input.minimumWords as number | undefined, bonusPerExtraWord: input.bonusPerExtraWord as number | undefined, difficulty: input.difficulty as PuzzleDifficulty, variants: count as number | undefined, seed }
  if (input.type === 'sudoku') return { type: 'sudoku', size: input.size as SudokuSize, difficulty: input.difficulty as PuzzleDifficulty, variants: count as number | undefined, seed }
  if (input.type === 'crossword') return { type: 'crossword', rows: input.rows as number, columns: input.columns as number, entries: input.entries as CrosswordInput[], variants: count as number | undefined, seed }
  fail('Choose word search, Sudoku, or crossword generation.')
}
