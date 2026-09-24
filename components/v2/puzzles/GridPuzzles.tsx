'use client'

import { useEffect, useId, useState, type KeyboardEvent } from 'react'
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
  const instanceId = useId().replace(/:/g, '')
  const crosswordColumns = definition.type === 'crossword' ? definition.columns : 0
  const [enlarged, setEnlarged] = useState(crosswordColumns > 10)
  const { submit, busy, error } = usePuzzleSubmission(onChange)
  const locked = disabled || busy

  useEffect(() => {
    if (definition.type === 'crossword') setEnlarged(crosswordColumns > 10)
  }, [definition.type, crosswordColumns])

  if (definition.type === 'sudoku' && state.type === 'sudoku') {
    const box = Math.sqrt(definition.size)
    return <div>
      <p className="mb-3 text-sm text-stone-600">Fill every row, column, and box with the numbers 1–{definition.size}. Printed numbers stay fixed. Arrow keys move between editable squares.</p>
      <div data-puzzle-grid role="group" aria-label="Sudoku puzzle grid" aria-busy={locked} className="mx-auto grid w-full max-w-md touch-manipulation border-2 border-stone-700" style={{ gridTemplateColumns: `repeat(${definition.size}, minmax(0, 1fr))` }}>
        {state.grid.flatMap((row, r) => row.map((cell, c) => <input key={`${r}:${c}`} data-row={r} data-column={c} value={cell || ''} inputMode="numeric" pattern={`[1-${definition.size}]?`} maxLength={1} readOnly={locked || definition.givens[r][c] !== 0} tabIndex={definition.givens[r][c] ? -1 : 0} onFocus={event => event.currentTarget.select()} onKeyDown={event => moveFocus(event, r, c, definition.size, definition.size)} aria-label={`Row ${r + 1}, column ${c + 1}${definition.givens[r][c] ? ', printed number' : ''}`} className={`aspect-square w-full min-w-0 rounded-none border border-stone-300 text-center text-[clamp(0.75rem,4vw,1.125rem)] focus:z-10 focus:outline-emerald-600 ${locked ? 'opacity-60' : ''} ${definition.givens[r][c] ? 'bg-stone-200 font-bold text-stone-900' : 'bg-white text-emerald-900'}`} style={{ borderRightWidth: (c + 1) % box === 0 ? 2 : 1, borderBottomWidth: (r + 1) % box === 0 ? 2 : 1, borderRightColor: (c + 1) % box === 0 ? '#44403c' : undefined, borderBottomColor: (r + 1) % box === 0 ? '#44403c' : undefined }} onChange={event => {
          if (locked) return
          const value = event.target.value
          if (value && !new RegExp(`^[1-${definition.size}]$`).test(value)) return
          const grid = state.grid.map(line => [...line]); grid[r][c] = value ? Number(value) : 0
          void submit({ grid })
        }} />))}
      </div>
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
  const dense = definition.columns > 10
  const expandedWidth = definition.columns * 44 + Math.max(0, definition.columns - 1) + 2

  return <div>
    <p className="mb-3 text-sm text-stone-600">Use the clues to fill the white squares. Your letters are saved after each change. Arrow keys move between squares.</p>
    {dense && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
      <p className="min-w-0 flex-1">Large crossword: {enlarged ? 'swipe inside the grid to pan between easier-to-tap boxes.' : 'the whole board is fitted to the screen, so boxes are smaller.'}</p>
      <button type="button" aria-pressed={enlarged} onClick={() => setEnlarged(value => !value)} className="min-h-11 rounded-lg border border-sky-700 bg-white px-3 font-semibold">{enlarged ? 'Fit whole grid' : 'Enlarge grid'}</button>
    </div>}
    <div role={enlarged ? 'region' : undefined} aria-label={enlarged ? 'Scrollable crossword grid' : undefined} tabIndex={enlarged ? 0 : undefined} className={enlarged ? 'max-h-[70vh] overflow-auto overscroll-contain rounded border border-stone-300' : ''}>
      <div data-puzzle-grid role="group" aria-label="Crossword puzzle grid" aria-busy={locked} className={`grid touch-manipulation gap-px bg-stone-600 p-px ${enlarged ? '' : 'mx-auto w-full max-w-md'}`} style={{ gridTemplateColumns: `repeat(${definition.columns}, minmax(0, 1fr))`, ...(enlarged ? { width: `${expandedWidth}px` } : {}) }}>
        {state.grid.flatMap((row, r) => row.map((cell, c) => {
          const key = `${r}:${c}`
          if (!occupied.has(key)) return <div key={key} aria-hidden="true" className="aspect-square min-h-0 min-w-0 bg-stone-800" />
          return <label key={key} className="relative aspect-square min-h-0 min-w-0 bg-white">
            {starts.has(key) && <span aria-hidden="true" className="pointer-events-none absolute left-0.5 top-0 text-[clamp(0.35rem,1.7vw,0.625rem)] font-semibold leading-none">{starts.get(key)}</span>}
            <input data-row={r} data-column={c} value={cell} maxLength={1} autoCapitalize="characters" autoComplete="off" readOnly={locked} onFocus={event => event.currentTarget.select()} onKeyDown={event => moveFocus(event, r, c, definition.rows, definition.columns)} aria-label={`Row ${r + 1}, column ${c + 1}${starts.has(key) ? `, clue ${starts.get(key)}` : ''}`} className={`h-full w-full min-w-0 appearance-none bg-white pt-[12%] text-center text-[clamp(0.6rem,4vw,1.125rem)] uppercase leading-none text-emerald-950 focus:outline-emerald-600 ${locked ? 'opacity-60' : ''}`} onChange={event => {
              if (locked) return
              const value = event.target.value.toUpperCase()
              if (!/^[A-Z]?$/.test(value)) return
              const grid = state.grid.map(line => [...line]); grid[r][c] = value
              void submit({ grid })
            }} />
          </label>
        }))}
      </div>
    </div>
    <div className="mt-5 grid gap-5 text-sm sm:grid-cols-2">{(['across', 'down'] as const).map(direction => {
      const headingId = `${instanceId}-crossword-${direction}`
      return <section key={direction} aria-labelledby={headingId}><h3 id={headingId} className="mb-2 font-bold capitalize">{direction}</h3><ol className="space-y-2">{definition.entries.filter(entry => entry.direction === direction).map(entry => {
        const clueNumber = starts.get(`${entry.row}:${entry.column}`)
        return <li key={entry.id} className="leading-relaxed"><strong>{clueNumber}.</strong> {entry.clue} ({entry.length})</li>
      })}</ol></section>
    })}</div>
    <PuzzleSaveMessage busy={busy} error={error} />
  </div>
}
