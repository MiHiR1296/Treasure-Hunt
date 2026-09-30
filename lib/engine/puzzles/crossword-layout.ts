export interface CrosswordLayoutEntry {
  id: string
  clue: string
  answer: string
  row: number
  column: number
  direction: 'across' | 'down'
}

/** Arrange authored answers into a compact, crossing-first layout for the builder. */
export function autoArrangeCrossword(entries: CrosswordLayoutEntry[], rows: number, columns: number): CrosswordLayoutEntry[] {
  const board = Array.from({ length: rows }, () => Array<string>(columns).fill(''))
  const boardDirections = new Map<string, Set<'across' | 'down'>>()
  const placed: CrosswordLayoutEntry[] = []
  const cells = (entry: CrosswordLayoutEntry, row: number, column: number, direction: 'across' | 'down') => [...entry.answer.toUpperCase()].map((letter, index) => ({
    row: row + (direction === 'down' ? index : 0),
    column: column + (direction === 'across' ? index : 0),
    letter,
  }))
  const fits = (entry: CrosswordLayoutEntry, row: number, column: number, direction: 'across' | 'down') => {
    const candidate = cells(entry, row, column, direction)
    if (!candidate.length || candidate.some(cell => cell.row < 0 || cell.column < 0 || cell.row >= rows || cell.column >= columns)) return null
    let crossings = 0
    for (const cell of candidate) {
      if (boardDirections.get(`${cell.row}:${cell.column}`)?.has(direction)) return null
      const existing = board[cell.row][cell.column]
      if (existing && existing !== cell.letter) return null
      if (existing === cell.letter) crossings++
    }
    return { candidate, crossings }
  }

  for (const original of entries) {
    if (!original.answer.trim()) { placed.push({ ...original }); continue }
    const candidates: { row: number; column: number; direction: 'across' | 'down'; crossings: number; distance: number; candidate: { row: number; column: number; letter: string }[] }[] = []
    for (const direction of ['across', 'down'] as const) for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const result = fits(original, row, column, direction)
      if (!result || (placed.length > 0 && result.crossings === 0)) continue
      candidates.push({ row, column, direction, crossings: result.crossings, distance: Math.abs(row - (rows - 1) / 2) + Math.abs(column - (columns - 1) / 2), candidate: result.candidate })
    }
    if (!candidates.length) for (const direction of ['across', 'down'] as const) for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const result = fits(original, row, column, direction)
      if (result) candidates.push({ row, column, direction, crossings: result.crossings, distance: Math.abs(row - (rows - 1) / 2) + Math.abs(column - (columns - 1) / 2), candidate: result.candidate })
    }
    const chosen = candidates.sort((a, b) => b.crossings - a.crossings || a.distance - b.distance)[0]
    if (!chosen) { placed.push({ ...original }); continue }
    for (const cell of chosen.candidate) {
      board[cell.row][cell.column] = cell.letter
      const key = `${cell.row}:${cell.column}`
      const directions = boardDirections.get(key) || new Set<'across' | 'down'>()
      directions.add(chosen.direction)
      boardDirections.set(key, directions)
    }
    placed.push({ ...original, row: chosen.row, column: chosen.column, direction: chosen.direction })
  }
  return placed
}
