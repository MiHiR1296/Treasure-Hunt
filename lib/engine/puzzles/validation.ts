import type { PuzzleDefinition } from './types'
import { containsWord, identifier, integer, matrix, permutation, record, sudokuSolvable, text, word } from './helpers'

export function validatePuzzle(value: unknown): string[] {
  const errors: string[] = []
  const fail = (message: string) => { errors.push(message) }
  if (!record(value) || typeof value.type !== 'string') return ['Puzzle must be an object with a supported type.']
  const fields: Record<string, string[]> = {
    jigsaw: ['rows', 'columns', 'pieces', 'solution'], sudoku: ['size', 'givens'], word_search: ['grid', 'words'], crossword: ['rows', 'columns', 'entries'],
    rotation: ['columns', 'tiles'], text: ['prompt', 'answers', 'caseSensitive'], multiple_choice: ['prompt', 'options', 'correctOptionId'], matching: ['left', 'right', 'solution'], sequence: ['items', 'solution'],
  }
  if (!Object.hasOwn(fields, value.type)) return ['Unsupported puzzle type.']
  if (Object.keys(value).some(key => key !== 'type' && !fields[value.type as string].includes(key))) fail('Puzzle contains unsupported fields.')
  const list = (items: unknown, min: number, max: number): items is unknown[] => Array.isArray(items) && items.length >= min && items.length <= max
  const itemList = (items: unknown, images = false, rotations = false): boolean => {
    if (!list(items, images ? 1 : 2, images ? 64 : 30)) return false
    const keys = images ? ['id', 'imageUrl', 'alt', ...(rotations ? ['correctRotation'] : [])] : ['id', 'label']
    return items.every(item => record(item) && identifier(item.id) && !Object.keys(item).some(key => !keys.includes(key)) &&
      (images ? text(item.imageUrl, 2048) && (/^https:\/\/[^\s]+$/.test(item.imageUrl) || /^\/(?!\/)[^\s]*$/.test(item.imageUrl)) && (item.alt === undefined || text(item.alt, 500)) && (!rotations || [0, 90, 180, 270].includes(item.correctRotation as number)) : text(item.label, 500))) && new Set(items.map(item => (item as { id: string }).id)).size === items.length
  }
  switch (value.type) {
    case 'jigsaw': {
      if (!integer(value.rows, 2, 8) || !integer(value.columns, 2, 8)) fail('Jigsaw rows and columns must be between 2 and 8.')
      if (!itemList(value.pieces, true)) fail('Jigsaw pieces need unique IDs and HTTPS or local image URLs.')
      else {
        const pieces = value.pieces as { id: string }[]
        if (pieces.length !== Number(value.rows) * Number(value.columns)) fail('Jigsaw needs one image piece for every position.')
        if (!permutation(value.solution, pieces.map(piece => piece.id))) fail('Jigsaw solution must include every piece exactly once.')
      }
      break
    }
    case 'sudoku': {
      if (value.size !== 4 && value.size !== 9) { fail('Sudoku size must be 4 or 9.'); break }
      if (!matrix(value.givens, value.size, value.size, cell => integer(cell, 0, value.size as number))) fail('Sudoku givens must be a square number grid; use 0 for blank cells.')
      else if (!sudokuSolvable(value.givens as number[][], value.size)) fail('Sudoku givens conflict, have no solution, or exceed the supported solving complexity.')
      else if ((value.givens as number[][]).every(row => row.every(Boolean))) fail('Sudoku needs at least one blank cell for the player.')
      break
    }
    case 'word_search': {
      const grid = value.grid
      if (!list(grid, 2, 25) || !Array.isArray(grid[0]) || !integer(grid[0].length, 2, 25) || !matrix(grid, grid.length, grid[0].length, letter => typeof letter === 'string' && /^[a-zA-Z]$/.test(letter))) fail('Word search needs a rectangular letter grid between 2×2 and 25×25.')
      if (!list(value.words, 1, 50) || !value.words.every(word)) fail('Word search needs 1 to 50 words using letters only.')
      else if (!errors.length) {
        const words = (value.words as string[]).map(item => item.toUpperCase())
        if (new Set(words).size !== words.length) fail('Word search words must be unique.')
        for (const target of words) if (!containsWord(grid as string[][], target)) fail(`Word ${target} does not appear in a straight line in the grid.`)
      }
      break
    }
    case 'crossword': {
      if (!integer(value.rows, 2, 30) || !integer(value.columns, 2, 30)) fail('Crossword dimensions must be between 2 and 30.')
      if (!list(value.entries, 1, 100)) { fail('Crossword needs between 1 and 100 entries.'); break }
      const occupied = new Map<string, string>()
      const ids = new Set<string>()
      const starts = new Set<string>()
      for (const entry of value.entries) {
        if (!record(entry) || Object.keys(entry).some(key => !['id', 'clue', 'answer', 'row', 'column', 'direction'].includes(key)) || !identifier(entry.id) || !text(entry.clue) || !word(entry.answer) || !integer(entry.row, 0, Number(value.rows) - 1) || !integer(entry.column, 0, Number(value.columns) - 1) || !['across', 'down'].includes(entry.direction as string)) { fail('Crossword entries need an ID, clue, letter-only answer, direction, and valid starting cell.'); continue }
        const start = `${entry.row}:${entry.column}:${entry.direction}`
        if (ids.has(entry.id) || starts.has(start)) fail('Crossword entries need unique IDs and starting directions.')
        ids.add(entry.id); starts.add(start)
        for (const [index, letter] of [...entry.answer.toUpperCase()].entries()) {
          const row = entry.row + (entry.direction === 'down' ? index : 0)
          const column = entry.column + (entry.direction === 'across' ? index : 0)
          if (row >= Number(value.rows) || column >= Number(value.columns)) fail(`Crossword answer ${entry.id} extends outside the grid.`)
          const key = `${row}:${column}`
          if (occupied.has(key) && occupied.get(key) !== letter) fail(`Crossword letters conflict at row ${row + 1}, column ${column + 1}.`)
          occupied.set(key, letter)
        }
      }
      break
    }
    case 'rotation': {
      if (!integer(value.columns, 1, 8)) fail('Rotation puzzle needs between 1 and 8 columns.')
      if (!itemList(value.tiles, true, true)) fail('Rotation tiles need unique IDs, image URLs, and correctRotation of 0, 90, 180, or 270.')
      else if (!(value.tiles as { correctRotation: number }[]).some(tile => tile.correctRotation !== 0)) fail('At least one tile must need rotation from its initial image orientation.')
      break
    }
    case 'text':
      if (!text(value.prompt)) fail('Text puzzle needs a prompt.')
      if (!list(value.answers, 1, 100) || !value.answers.every(answer => text(answer, 2048))) fail('Text puzzle needs at least one accepted answer.')
      if (value.caseSensitive !== undefined && typeof value.caseSensitive !== 'boolean') fail('caseSensitive must be a boolean.')
      break
    case 'multiple_choice':
      if (!text(value.prompt)) fail('Multiple choice needs a prompt.')
      if (!itemList(value.options)) fail('Multiple choice needs 2 to 30 unique, labeled options.')
      else if (!(value.options as { id: string }[]).some(option => option.id === value.correctOptionId)) fail('Multiple choice needs a correct option ID from its options.')
      break
    case 'matching': {
      if (!itemList(value.left) || !itemList(value.right)) { fail('Matching needs two lists of 2 to 30 unique, labeled items.'); break }
      const left = (value.left as { id: string }[]).map(item => item.id)
      const right = (value.right as { id: string }[]).map(item => item.id)
      if (left.length !== right.length || !list(value.solution, left.length, left.length) || !value.solution.every(pair => record(pair) && Object.keys(pair).length === 2 && left.includes(pair.leftId as string) && right.includes(pair.rightId as string)) || new Set(value.solution.map(pair => (pair as { leftId: string }).leftId)).size !== left.length || new Set(value.solution.map(pair => (pair as { rightId: string }).rightId)).size !== right.length) fail('Matching solution must pair every item exactly once.')
      break
    }
    case 'sequence':
      if (!itemList(value.items)) fail('Sequence needs 2 to 30 unique, labeled items.')
      else if (!permutation(value.solution, (value.items as { id: string }[]).map(item => item.id))) fail('Sequence solution must contain every item exactly once.')
      break
  }
  return errors
}

export function crosswordSolution(definition: Extract<PuzzleDefinition, { type: 'crossword' }>): string[][] {
  const grid = Array.from({ length: definition.rows }, () => Array<string>(definition.columns).fill(''))
  for (const entry of definition.entries) [...entry.answer.toUpperCase()].forEach((letter, index) => {
    grid[entry.row + (entry.direction === 'down' ? index : 0)][entry.column + (entry.direction === 'across' ? index : 0)] = letter
  })
  return grid
}
