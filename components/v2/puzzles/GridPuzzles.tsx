'use client'

import type { KeyboardEvent } from 'react'
import { PuzzleSaveMessage, usePuzzleSubmission, type PuzzlePlayerProps } from './shared'

function moveFocus(event: KeyboardEvent<HTMLInputElement>, row: number, column: number, rows: number, columns: number) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const direction: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
  const step = direction[event.key]
  if (!step) return
  event.preventDefault()
  const grid = event.currentTarget.closest('[data-puzzle-grid]')
  for (let r = row + step[0], c = column + step[1]; r >= 0 && c >= 0 && r < rows && c < columns; r += step[0], c += step[1]) {
    const cell = grid?.querySelector<HTMLInputElement>(`input[data-row="${r}"][data-column="${c}"]`)
    if (cell && cell.tabIndex !== -1) { cell.focus(); cell.select(); return }
  }
}

export default function GridPuzzles({ definition, state, disabled, onChange }: PuzzlePlayerProps) {
  const { submit, busy, error } = usePuzzleSubmission(onChange)
  const locked = disabled || busy
  if (definition.type === 'sudoku' && state.type === 'sudoku') {
    const box = Math.sqrt(definition.size)
    return <div>
      <p className="mb-3 text-sm text-stone-600">Fill every row, column, and box with the numbers 1–{definition.size}. Printed numbers stay fixed. Arrow keys move between editable squares.</p>
      <div className="overflow-x-auto pb-1"><div data-puzzle-grid role="group" aria-label="Sudoku puzzle grid" aria-busy={locked} className="grid border-2 border-stone-700" style={{ gridTemplateColumns: `repeat(${definition.size}, minmax(36px, 1fr))` }}>
        {state.grid.flatMap((row, r) => row.map((cell, c) => <input key={`${r}:${c}`} data-row={r} data-column={c} value={cell || ''} inputMode="numeric" pattern={`[1-${definition.size}]?`} maxLength={1} readOnly={locked || definition.givens[r][c] !== 0} tabIndex={definition.givens[r][c] ? -1 : 0} onFocus={event => event.currentTarget.select()} onKeyDown={event => moveFocus(event, r, c, definition.size, definition.size)} aria-label={`Row ${r + 1}, column ${c + 1}${definition.givens[r][c] ? ', printed number' : ''}`} className={`aspect-square min-h-11 w-full min-w-0 rounded-none border border-stone-300 text-center text-lg focus:z-10 focus:outline-emerald-600 ${locked ? 'opacity-60' : ''} ${definition.givens[r][c] ? 'bg-stone-200 font-bold text-stone-900' : 'bg-white text-emerald-900'}`} style={{ borderRightWidth: (c + 1) % box === 0 ? 2 : 1, borderBottomWidth: (r + 1) % box === 0 ? 2 : 1, borderRightColor: (c + 1) % box === 0 ? '#44403c' : undefined, borderBottomColor: (r + 1) % box === 0 ? '#44403c' : undefined }} onChange={event => {
          if (locked) return
          const value = event.target.value
          if (value && !new RegExp(`^[1-${definition.size}]$`).test(value)) return
          const grid = state.grid.map(line => [...line]); grid[r][c] = value ? Number(value) : 0
          void submit({ grid })
        }} />))}
      </div></div>
      <PuzzleSaveMessage busy={busy} error={error} />
    </div>
  }
  if (definition.type !== 'crossword' || state.type !== 'crossword') return null
  const occupied = new Set<string>()
  const starts = new Map<string, number>()
  definition.entries.forEach((entry, index) => {
    const key = `${entry.row}:${entry.column}`
    if (!starts.has(key)) starts.set(key, index + 1)
    for (let i = 0; i < entry.length; i++) occupied.add(`${entry.row + (entry.direction === 'down' ? i : 0)}:${entry.column + (entry.direction === 'across' ? i : 0)}`)
  })
  return <div>
    <p className="mb-3 text-sm text-stone-600">Use the clues to fill the white squares. Your letters are saved after each change. Arrow keys move between squares.</p>
    <div className="overflow-x-auto pb-2"><div data-puzzle-grid role="group" aria-label="Crossword puzzle grid" aria-busy={locked} className="grid gap-px bg-stone-600 p-px" style={{ gridTemplateColumns: `repeat(${definition.columns}, minmax(36px, 1fr))` }}>
      {state.grid.flatMap((row, r) => row.map((cell, c) => {
        const key = `${r}:${c}`
        if (!occupied.has(key)) return <div key={key} aria-hidden="true" className="aspect-square min-h-11 bg-stone-800" />
        return <label key={key} className="relative aspect-square min-h-11 bg-white">
          {starts.has(key) && <span aria-hidden="true" className="pointer-events-none absolute left-0.5 top-0 text-[10px] font-semibold">{starts.get(key)}</span>}
          <input data-row={r} data-column={c} value={cell} maxLength={1} autoCapitalize="characters" autoComplete="off" readOnly={locked} onFocus={event => event.currentTarget.select()} onKeyDown={event => moveFocus(event, r, c, definition.rows, definition.columns)} aria-label={`Row ${r + 1}, column ${c + 1}${starts.has(key) ? `, clue ${starts.get(key)}` : ''}`} className={`h-full w-full min-w-0 bg-white pt-2 text-center text-lg uppercase text-emerald-950 focus:outline-emerald-600 ${locked ? 'opacity-60' : ''}`} onChange={event => {
            if (locked) return
            const value = event.target.value.toUpperCase()
            if (!/^[A-Z]?$/.test(value)) return
            const grid = state.grid.map(line => [...line]); grid[r][c] = value
            void submit({ grid })
          }} />
        </label>
      }))}
    </div></div>
    <div className="mt-4 space-y-3 text-sm">{(['across', 'down'] as const).map(direction => <div key={direction}><h3 className="mb-1 font-bold capitalize">{direction}</h3><ul className="space-y-2">{definition.entries.filter(entry => entry.direction === direction).map(entry => <li key={entry.id}><strong>{starts.get(`${entry.row}:${entry.column}`)}.</strong> {entry.clue} ({entry.length})</li>)}</ul></div>)}</div>
    <PuzzleSaveMessage busy={busy} error={error} />
  </div>
}
