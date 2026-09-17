import { copy, integer, matrix, permutation, record, same, shuffled, straightPath, submission, sudokuConsistent } from './helpers'
import { crosswordSolution, validatePuzzle } from './validation'
import { PuzzleError, type ImagePiece, type MatchingPair, type PuzzleDefinition, type PuzzlePublicDefinition, type PuzzleState, type PuzzleUpdate, type QuarterTurn } from './types'

type PuzzleType = PuzzleDefinition['type']
interface PuzzleModule<T extends PuzzleType> {
  initial: (definition: Extract<PuzzleDefinition, { type: T }>) => Extract<PuzzleState, { type: T }>
  public: (definition: Extract<PuzzleDefinition, { type: T }>) => Extract<PuzzlePublicDefinition, { type: T }>
  update: (definition: Extract<PuzzleDefinition, { type: T }>, state: Extract<PuzzleState, { type: T }>, value: unknown) => PuzzleUpdate
}
interface RegistryEntry {
  initial: (definition: PuzzleDefinition) => PuzzleState
  public: (definition: PuzzleDefinition) => PuzzlePublicDefinition
  update: (definition: PuzzleDefinition, state: PuzzleState, value: unknown) => PuzzleUpdate
}

function createPuzzleModule<T extends PuzzleType>(type: T, implementation: PuzzleModule<T>): RegistryEntry {
  return {
    initial(definition) {
      if (definition.type !== type) throw new PuzzleError('invalid_puzzle', 'Puzzle type does not match its module.')
      return implementation.initial(definition as Extract<PuzzleDefinition, { type: T }>)
    },
    public(definition) {
      if (definition.type !== type) throw new PuzzleError('invalid_puzzle', 'Puzzle type does not match its module.')
      return implementation.public(definition as Extract<PuzzleDefinition, { type: T }>)
    },
    update(definition, state, value) {
      if (definition.type !== type || state.type !== type) throw new PuzzleError('invalid_puzzle_state', 'The saved puzzle belongs to a different puzzle type.')
      return implementation.update(definition as Extract<PuzzleDefinition, { type: T }>, state as Extract<PuzzleState, { type: T }>, value)
    },
  }
}

const invalidMove = (message: string): never => { throw new PuzzleError('invalid_submission', message) }
const image = (piece: ImagePiece): ImagePiece => ({ id: piece.id, imageUrl: piece.imageUrl, ...(piece.alt === undefined ? {} : { alt: piece.alt }) })

/** Private modules: only public projections and player-entered state reach clients. */
export const puzzleRegistry: Readonly<Record<PuzzleType, RegistryEntry>> = Object.freeze({
  jigsaw: createPuzzleModule('jigsaw', {
    initial: definition => ({ type: 'jigsaw', order: shuffled(definition.pieces.map(piece => piece.id), definition.solution) }),
    public: definition => ({ type: 'jigsaw', rows: definition.rows, columns: definition.columns, pieces: shuffled(definition.pieces.map(piece => piece.id), definition.solution).map(id => image(definition.pieces.find(piece => piece.id === id)!)) }),
    update(definition, _state, value) {
      const { order } = submission(value, ['order'])
      if (!permutation(order, definition.pieces.map(piece => piece.id))) return invalidMove('Every image piece must appear exactly once.')
      return { state: { type: 'jigsaw', order: [...order] }, completed: same(order, definition.solution) }
    },
  }),
  sudoku: createPuzzleModule('sudoku', {
    initial: definition => ({ type: 'sudoku', grid: copy(definition.givens) }),
    public: definition => ({ type: 'sudoku', size: definition.size, givens: copy(definition.givens) }),
    update(definition, _state, value) {
      const { grid } = submission(value, ['grid'])
      if (!matrix(grid, definition.size, definition.size, cell => integer(cell, 0, definition.size))) return invalidMove('Use a square grid with valid Sudoku numbers, or 0 for a blank.')
      const numbers = grid as number[][]
      if (definition.givens.some((row, r) => row.some((given, c) => given !== 0 && numbers[r][c] !== given))) return invalidMove('The printed Sudoku numbers cannot be changed.')
      return { state: { type: 'sudoku', grid: copy(numbers) }, completed: numbers.every(row => row.every(Boolean)) && sudokuConsistent(numbers, definition.size) }
    },
  }),
  word_search: createPuzzleModule('word_search', {
    initial: () => ({ type: 'word_search', foundWords: [] }),
    public: definition => ({ type: 'word_search', grid: definition.grid.map(row => row.map(letter => letter.toUpperCase())), words: definition.words.map(word => word.toUpperCase()) }),
    update(definition, state, value) {
      const { path } = submission(value, ['path'])
      if (!straightPath(path, definition.grid.length, definition.grid[0].length)) return invalidMove('Select one straight line of adjoining letters.')
      const letters = path.map(cell => definition.grid[cell.row][cell.column]).join('').toUpperCase()
      const reverse = [...letters].reverse().join('')
      const targetWords = definition.words.map(word => word.toUpperCase())
      // Prefer the selected direction when two listed words reverse each other.
      const found = targetWords.find(word => word === letters) ?? targetWords.find(word => word === reverse)
      const foundWords = [...new Set([...state.foundWords, ...(found ? [found] : [])])]
      return { state: { type: 'word_search', foundWords }, completed: targetWords.every(word => foundWords.includes(word)) }
    },
  }),
  crossword: createPuzzleModule('crossword', {
    initial: definition => ({ type: 'crossword', grid: Array.from({ length: definition.rows }, () => Array<string>(definition.columns).fill('')) }),
    public: definition => ({ type: 'crossword', rows: definition.rows, columns: definition.columns, entries: definition.entries.map(entry => ({ id: entry.id, clue: entry.clue, length: entry.answer.length, row: entry.row, column: entry.column, direction: entry.direction })) }),
    update(definition, _state, value) {
      const { grid } = submission(value, ['grid'])
      if (!matrix(grid, definition.rows, definition.columns, letter => typeof letter === 'string' && /^[a-zA-Z]?$/.test(letter))) return invalidMove('Use one letter per crossword cell, or leave it blank.')
      const normalized = (grid as string[][]).map(row => row.map(letter => letter.toUpperCase()))
      const answer = crosswordSolution(definition)
      if (normalized.some((row, r) => row.some((letter, c) => answer[r][c] === '' && letter !== ''))) return invalidMove('Black crossword cells cannot contain letters.')
      return { state: { type: 'crossword', grid: normalized }, completed: same(normalized, answer) }
    },
  }),
  rotation: createPuzzleModule('rotation', {
    initial: definition => ({ type: 'rotation', rotations: Object.fromEntries(definition.tiles.map(tile => [tile.id, 0])) }),
    public: definition => ({ type: 'rotation', columns: definition.columns, tiles: definition.tiles.map(image) }),
    update(definition, _state, value) {
      const { rotations } = submission(value, ['rotations'])
      if (!record(rotations) || !permutation(Object.keys(rotations), definition.tiles.map(tile => tile.id)) || Object.values(rotations).some(rotation => ![0, 90, 180, 270].includes(rotation as number))) return invalidMove('Each tile needs a rotation of 0, 90, 180, or 270 degrees.')
      const result = rotations as Record<string, QuarterTurn>
      return { state: { type: 'rotation', rotations: { ...result } }, completed: definition.tiles.every(tile => result[tile.id] === tile.correctRotation) }
    },
  }),
  text: createPuzzleModule('text', {
    initial: () => ({ type: 'text', value: '' }),
    public: definition => ({ type: 'text', prompt: definition.prompt }),
    update(definition, _state, value) {
      const input = submission(value, ['value']).value
      if (typeof input !== 'string' || input.length > 2048) return invalidMove('Enter an answer of at most 2048 characters.')
      const normalize = (answer: string) => { const result = answer.normalize('NFKC').trim().replace(/\s+/g, ' '); return definition.caseSensitive ? result : result.toLowerCase() }
      return { state: { type: 'text', value: input }, completed: definition.answers.some(answer => normalize(answer) === normalize(input)) }
    },
  }),
  multiple_choice: createPuzzleModule('multiple_choice', {
    initial: () => ({ type: 'multiple_choice', optionId: null }),
    public: definition => ({ type: 'multiple_choice', prompt: definition.prompt, options: definition.options.map(option => ({ id: option.id, label: option.label })) }),
    update(definition, _state, value) {
      const { optionId } = submission(value, ['optionId'])
      if (typeof optionId !== 'string' || !definition.options.some(option => option.id === optionId)) return invalidMove('Choose one of the available answers.')
      return { state: { type: 'multiple_choice', optionId }, completed: optionId === definition.correctOptionId }
    },
  }),
  matching: createPuzzleModule('matching', {
    initial: () => ({ type: 'matching', pairs: [] }),
    public: definition => ({ type: 'matching', left: definition.left.map(item => ({ id: item.id, label: item.label })), right: shuffled(definition.right.map(item => item.id)).map(id => { const item = definition.right.find(candidate => candidate.id === id)!; return { id: item.id, label: item.label } }) }),
    update(definition, _state, value) {
      const { pairs } = submission(value, ['pairs'])
      if (!Array.isArray(pairs) || pairs.length > definition.left.length || !pairs.every(pair => record(pair) && Object.keys(pair).length === 2 && definition.left.some(item => item.id === pair.leftId) && definition.right.some(item => item.id === pair.rightId)) || new Set(pairs.map(pair => pair.leftId)).size !== pairs.length || new Set(pairs.map(pair => pair.rightId)).size !== pairs.length) return invalidMove('Match each item to at most one item on the other side.')
      return { state: { type: 'matching', pairs: copy(pairs as MatchingPair[]) }, completed: definition.solution.every(solution => pairs.some(pair => pair.leftId === solution.leftId && pair.rightId === solution.rightId)) }
    },
  }),
  sequence: createPuzzleModule('sequence', {
    initial: definition => ({ type: 'sequence', order: shuffled(definition.items.map(item => item.id), definition.solution) }),
    public: definition => ({ type: 'sequence', items: shuffled(definition.items.map(item => item.id), definition.solution).map(id => { const item = definition.items.find(candidate => candidate.id === id)!; return { id: item.id, label: item.label } }) }),
    update(definition, _state, value) {
      const { order } = submission(value, ['order'])
      if (!permutation(order, definition.items.map(item => item.id))) return invalidMove('Every sequence item must appear exactly once.')
      return { state: { type: 'sequence', order: [...order] }, completed: same(order, definition.solution) }
    },
  }),
})

function checked(definition: PuzzleDefinition): RegistryEntry {
  const errors = validatePuzzle(definition)
  if (errors.length) throw new PuzzleError('invalid_puzzle', errors.join(' '))
  return puzzleRegistry[definition.type]
}

export function initialPuzzleState(definition: PuzzleDefinition): PuzzleState { return checked(definition).initial(definition) }
export function publicPuzzle(definition: PuzzleDefinition): PuzzlePublicDefinition { return checked(definition).public(definition) }
export function updatePuzzle(definition: PuzzleDefinition, state: PuzzleState, value: unknown): PuzzleUpdate {
  if (!record(state)) throw new PuzzleError('invalid_puzzle_state', 'The saved puzzle is unavailable. Please contact the organizer.')
  return checked(definition).update(definition, state, value)
}
