import type { Cell } from '@/lib/engine/puzzles/types'

const directions = [-1, 0, 1].flatMap(row => [-1, 0, 1].map(column => ({ row, column }))).filter(direction => direction.row || direction.column)

export const cellKey = (cell: Cell) => `${cell.row}:${cell.column}`

export function lineBetween(start: Cell, target: Cell, snap = false): Cell[] {
  let rowDistance = target.row - start.row
  let columnDistance = target.column - start.column
  if (snap && rowDistance && columnDistance && Math.abs(rowDistance) !== Math.abs(columnDistance)) {
    const rows = Math.abs(rowDistance)
    const columns = Math.abs(columnDistance)
    if (rows >= columns * 2) columnDistance = 0
    else if (columns >= rows * 2) rowDistance = 0
    else {
      const diagonal = Math.max(rows, columns)
      rowDistance = Math.sign(rowDistance) * diagonal
      columnDistance = Math.sign(columnDistance) * diagonal
    }
  }
  if (rowDistance && columnDistance && Math.abs(rowDistance) !== Math.abs(columnDistance)) return []
  const length = Math.max(Math.abs(rowDistance), Math.abs(columnDistance)) + 1
  return Array.from({ length }, (_, index) => ({
    row: start.row + Math.sign(rowDistance) * index,
    column: start.column + Math.sign(columnDistance) * index,
  }))
}

export function wordForPath(grid: string[][], path: Cell[], words: string[]): string | null {
  if (!path.length || path.some(cell => !grid[cell.row]?.[cell.column])) return null
  const letters = path.map(cell => grid[cell.row][cell.column]).join('').toUpperCase()
  return words.find(word => word.toUpperCase() === letters || word.toUpperCase() === [...letters].reverse().join('')) ?? null
}

export function findWordPath(grid: string[][], word: string): Cell[] {
  const target = word.toUpperCase()
  for (let row = 0; row < grid.length; row++) for (let column = 0; column < (grid[row]?.length ?? 0); column++) {
    for (const direction of directions) {
      const path = Array.from({ length: target.length }, (_, index) => ({ row: row + direction.row * index, column: column + direction.column * index }))
      if (path.every((cell, index) => grid[cell.row]?.[cell.column]?.toUpperCase() === target[index])) return path
    }
  }
  return []
}
