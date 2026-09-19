import { PuzzleError, type Cell } from './types'

export const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
export const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
export const text = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max
export const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value) && !Object.getOwnPropertyNames(Object.prototype).includes(value)
export const word = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z]{1,40}$/.test(value)
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export function submission(value: unknown, fields: string[]): Record<string, unknown> {
  if (!record(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) {
    throw new PuzzleError('invalid_submission', 'This puzzle move could not be understood. Refresh the puzzle and try again.')
  }
  return value
}

export function permutation(value: unknown, ids: string[]): value is string[] {
  return Array.isArray(value) && value.length === ids.length && new Set(value).size === ids.length && value.every(id => typeof id === 'string' && ids.includes(id))
}

export function matrix(value: unknown, rows: number, columns: number, cell: (value: unknown) => boolean): value is unknown[][] {
  return Array.isArray(value) && value.length === rows && value.every(row => Array.isArray(row) && row.length === columns && row.every(cell))
}

/** Stable initial layout, independent of submitted moves and private answer order. */
export function shuffled(ids: string[], avoid?: string[]): string[] {
  const hash = (value: string) => { let n = 2166136261; for (const c of value) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0 }
  const result = [...ids].sort((a, b) => hash(a) - hash(b) || a.localeCompare(b))
  if (avoid && same(result, avoid) && result.length > 1) [result[0], result[1]] = [result[1], result[0]]
  return result
}

export function sudokuConsistent(grid: number[][], size: number): boolean {
  const box = Math.sqrt(size)
  const unique = (values: number[]) => new Set(values.filter(Boolean)).size === values.filter(Boolean).length
  for (let index = 0; index < size; index++) {
    if (!unique(grid[index]) || !unique(grid.map(row => row[index]))) return false
    const startRow = Math.floor(index / box) * box
    const startColumn = index % box * box
    const values: number[] = []
    for (let row = startRow; row < startRow + box; row++) for (let column = startColumn; column < startColumn + box; column++) values.push(grid[row][column])
    if (!unique(values)) return false
  }
  return true
}

/** Bounded publish-time solvability check, choosing the most constrained cell first. */
export function sudokuSolvable(givens: number[][], size: number): boolean {
  const grid = copy(givens)
  const box = Math.sqrt(size)
  let budget = 200000
  const solve = (): boolean => {
    if (--budget < 0) return false
    let best: { row: number; column: number; candidates: number[] } | null = null
    for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
      if (grid[row][column]) continue
      const used = new Set([...grid[row], ...grid.map(line => line[column])])
      const startRow = Math.floor(row / box) * box
      const startColumn = Math.floor(column / box) * box
      for (let r = startRow; r < startRow + box; r++) for (let c = startColumn; c < startColumn + box; c++) used.add(grid[r][c])
      const candidates = Array.from({ length: size }, (_, i) => i + 1).filter(value => !used.has(value))
      if (!candidates.length) return false
      if (!best || candidates.length < best.candidates.length) best = { row, column, candidates }
    }
    if (!best) return true
    for (const value of best.candidates) {
      grid[best.row][best.column] = value
      if (solve()) return true
      grid[best.row][best.column] = 0
    }
    return false
  }
  return sudokuConsistent(grid, size) && solve()
}

export function straightPath(path: unknown, rows: number, columns: number): path is Cell[] {
  if (!Array.isArray(path) || !path.length || path.length > Math.max(rows, columns) || !path.every(cell => record(cell) && Object.keys(cell).length === 2 && integer(cell.row, 0, rows - 1) && integer(cell.column, 0, columns - 1))) return false
  if (path.length === 1) return true
  const rowStep = path[1].row - path[0].row
  const columnStep = path[1].column - path[0].column
  return Math.abs(rowStep) <= 1 && Math.abs(columnStep) <= 1 && (rowStep !== 0 || columnStep !== 0) && path.every((cell, index) => cell.row === path[0].row + index * rowStep && cell.column === path[0].column + index * columnStep)
}

export function containsWord(grid: string[][], target: string): boolean {
  for (let row = 0; row < grid.length; row++) for (let column = 0; column < grid[0].length; column++) {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue
      if ([...target].every((letter, index) => grid[row + dr * index]?.[column + dc * index]?.toUpperCase() === letter)) return true
    }
  }
  return false
}
