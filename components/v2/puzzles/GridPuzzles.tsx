'use client'

import { useState, type FormEvent, type KeyboardEvent } from 'react'
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
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({})
  const { submit, busy, error } = usePuzzleSubmission(onChange)
  const locked = disabled || busy
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
  const entryValue = (entry: (typeof definition.entries)[number], grid = state.grid) => Array.from({ length: entry.length }, (_, index) => grid[entry.row + (entry.direction === 'down' ? index : 0)][entry.column + (entry.direction === 'across' ? index : 0)]).join('')
  const syncDrafts = (grid: string[][]) => setDraftAnswers(current => Object.fromEntries(Object.keys(current).map(id => {
    const entry = definition.entries.find(candidate => candidate.id === id)
    return [id, entry ? entryValue(entry, grid) : current[id]]
  })))
  const placeAnswer = (event: FormEvent, entry: (typeof definition.entries)[number]) => {
    event.preventDefault()
    if (locked) return
    const value = draftAnswers[entry.id] ?? entryValue(entry)
    const grid = state.grid.map(row => [...row])
    for (let index = 0; index < entry.length; index++) grid[entry.row + (entry.direction === 'down' ? index : 0)][entry.column + (entry.direction === 'across' ? index : 0)] = value[index] || ''
    syncDrafts(grid)
    void submit({ grid }).then(saved => {
      if (!saved) return
      setDraftAnswers(current => {
        const next = { ...current }
        delete next[entry.id]
        return next
      })
    })
  }
  return <div>
    <p className="mb-3 text-sm text-stone-600">Type a whole answer under its clue, then place it in the boxes. You can still edit individual boxes; arrow keys move between them.</p>
    <div data-puzzle-grid role="group" aria-label="Crossword puzzle grid" aria-busy={locked} className="mx-auto grid w-full max-w-md touch-manipulation gap-px bg-stone-600 p-px" style={{ gridTemplateColumns: `repeat(${definition.columns}, minmax(0, 1fr))` }}>
      {state.grid.flatMap((row, r) => row.map((cell, c) => {
        const key = `${r}:${c}`
        if (!occupied.has(key)) return <div key={key} aria-hidden="true" className="aspect-square bg-stone-800" />
        return <label key={key} className="relative aspect-square min-w-0 bg-white">
          {starts.has(key) && <span aria-hidden="true" className="pointer-events-none absolute left-0.5 top-0 text-[clamp(0.35rem,1.7vw,0.625rem)] font-semibold leading-none">{starts.get(key)}</span>}
          <input data-row={r} data-column={c} value={cell} maxLength={1} autoCapitalize="characters" autoComplete="off" readOnly={locked} onFocus={event => event.currentTarget.select()} onKeyDown={event => moveFocus(event, r, c, definition.rows, definition.columns)} aria-label={`Row ${r + 1}, column ${c + 1}${starts.has(key) ? `, clue ${starts.get(key)}` : ''}`} className={`h-full w-full min-w-0 bg-white pt-[12%] text-center text-[clamp(0.6rem,4vw,1.125rem)] uppercase text-emerald-950 focus:outline-emerald-600 ${locked ? 'opacity-60' : ''}`} onChange={event => {
            if (locked) return
            const value = event.target.value.toUpperCase()
            if (!/^[A-Z]?$/.test(value)) return
            const grid = state.grid.map(line => [...line]); grid[r][c] = value
            syncDrafts(grid)
            void submit({ grid })
          }} />
        </label>
      }))}
    </div>
    <div className="mt-5 space-y-5 text-sm">{(['across', 'down'] as const).map(direction => <section key={direction} aria-labelledby={`crossword-${direction}`}><h3 id={`crossword-${direction}`} className="mb-2 font-bold capitalize">{direction}</h3><div className="space-y-3">{definition.entries.filter(entry => entry.direction === direction).map(entry => {
      const clueNumber = starts.get(`${entry.row}:${entry.column}`)
      const answer = draftAnswers[entry.id] ?? entryValue(entry)
      return <form key={entry.id} onSubmit={event => placeAnswer(event, entry)} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
        <label htmlFor={`crossword-answer-${entry.id}`} className="block leading-relaxed"><strong>{clueNumber}.</strong> {entry.clue} ({entry.length})</label>
        <div className="mt-2 flex flex-col gap-2 min-[380px]:flex-row">
          <input id={`crossword-answer-${entry.id}`} aria-label={`Answer for ${clueNumber} ${direction}`} value={answer} maxLength={entry.length} autoCapitalize="characters" autoComplete="off" spellCheck={false} disabled={locked} onChange={event => setDraftAnswers(current => ({ ...current, [entry.id]: event.target.value.replace(/[^a-z]/gi, '').toUpperCase().slice(0, entry.length) }))} className="min-h-12 min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base uppercase tracking-widest text-stone-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:opacity-60" placeholder={`${entry.length} letters`} />
          <button type="submit" disabled={locked} aria-label={`Place ${clueNumber} ${direction} in grid`} className="hunt-action min-h-12 rounded-lg border border-emerald-800 px-4 py-2 font-semibold text-emerald-900 disabled:opacity-50">Place in boxes</button>
        </div>
      </form>
    })}</div></section>)}</div>
    <PuzzleSaveMessage busy={busy} error={error} />
  </div>
}
