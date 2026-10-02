'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { PuzzleSaveMessage, usePuzzleSubmission, type PuzzlePlayerProps } from './shared'
import { sudokuBoxDimensions } from '@/lib/engine/puzzles/helpers'

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

const cloneGrid = (grid: string[][]) => grid.map(row => [...row])
const sameGrid = (left: string[][], right: string[][]) => left.length === right.length && left.every((row, rowIndex) => row.length === right[rowIndex]?.length && row.every((cell, columnIndex) => cell === right[rowIndex][columnIndex]))

/**
 * Crossword entry is optimistic: a team can keep typing while one snapshot is
 * in flight, but snapshots never overtake one another at the server boundary.
 */
function useQueuedCrosswordSave(grid: string[][], onChange: PuzzlePlayerProps['onChange']) {
  const [draft, setDraft] = useState(() => cloneGrid(grid))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef(cloneGrid(grid))
  const dirty = useRef(false)
  const sending = useRef(false)
  const timer = useRef<number | null>(null)

  const clearTimer = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null } }
  const flush = useCallback(async () => {
    clearTimer()
    if (sending.current || !dirty.current) return
    const snapshot = cloneGrid(latest.current)
    sending.current = true
    setSaving(true)
    try {
      await onChange({ grid: snapshot })
      if (sameGrid(snapshot, latest.current)) dirty.current = false
    } catch {
      dirty.current = false
      setError('The latest letters could not be saved. The shared crossword has been refreshed; re-enter any missing letters.')
    } finally {
      sending.current = false
      setSaving(false)
      if (dirty.current) timer.current = window.setTimeout(() => { void flush() }, 250)
    }
  }, [onChange])
  const schedule = useCallback(() => {
    clearTimer()
    timer.current = window.setTimeout(() => { void flush() }, 450)
  }, [flush])
  const change = useCallback((row: number, column: number, value: string) => {
    const next = cloneGrid(latest.current)
    next[row][column] = value
    latest.current = next
    dirty.current = true
    setError('')
    setDraft(next)
    schedule()
  }, [schedule])

  useEffect(() => {
    if (dirty.current || sending.current || sameGrid(latest.current, grid)) return
    const next = cloneGrid(grid)
    latest.current = next
    setDraft(next)
  }, [grid])
  useEffect(() => {
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') void flush() }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => { document.removeEventListener('visibilitychange', onVisibilityChange); clearTimer() }
  }, [flush])
  return { draft, change, flush, saving, error, pending: saving || dirty.current }
}

export default function GridPuzzles({ definition, state, disabled, onChange }: PuzzlePlayerProps) {
  const instanceId = useId().replace(/:/g, '')
  const crosswordColumns = definition.type === 'crossword' ? definition.columns : 0
  const [enlarged, setEnlarged] = useState(crosswordColumns > 10)
  const { submit, busy, error } = usePuzzleSubmission(onChange)
  const crosswordEntries = useMemo(() => definition.type === 'crossword' ? definition.entries : [], [definition])
  const crosswordGrid = definition.type === 'crossword' && state.type === 'crossword' ? state.grid : []
  const gridRef = useRef<HTMLDivElement>(null)
  const save = useQueuedCrosswordSave(crosswordGrid, onChange)
  const [activeEntryId, setActiveEntryId] = useState(crosswordEntries[0]?.id || '')
  const [activeCell, setActiveCell] = useState(`${crosswordEntries[0]?.row ?? 0}:${crosswordEntries[0]?.column ?? 0}`)
  const locked = disabled || busy

  useEffect(() => {
    if (definition.type === 'crossword') setEnlarged(crosswordColumns > 10)
  }, [definition.type, crosswordColumns])
  useEffect(() => {
    if (!crosswordEntries.some(entry => entry.id === activeEntryId)) {
      const first = crosswordEntries[0]
      setActiveEntryId(first?.id || '')
      setActiveCell(`${first?.row ?? 0}:${first?.column ?? 0}`)
    }
  }, [activeEntryId, crosswordEntries])

  if (definition.type === 'sudoku' && state.type === 'sudoku') {
    const box = sudokuBoxDimensions(definition.size)
    return <div>
      <p className="mb-3 text-sm text-stone-600">Fill every row, column, and box with the numbers 1–{definition.size}. Printed numbers stay fixed. Arrow keys move between editable squares.</p>
      <div data-puzzle-grid role="group" aria-label="Sudoku puzzle grid" aria-busy={locked} className="mx-auto grid w-full max-w-md touch-manipulation border-2 border-stone-700" style={{ gridTemplateColumns: `repeat(${definition.size}, minmax(0, 1fr))` }}>
        {state.grid.flatMap((row, r) => row.map((cell, c) => <input key={`${r}:${c}`} data-row={r} data-column={c} value={cell || ''} inputMode="numeric" pattern={`[1-${definition.size}]?`} maxLength={1} readOnly={locked || definition.givens[r][c] !== 0} tabIndex={definition.givens[r][c] ? -1 : 0} onFocus={event => event.currentTarget.select()} onKeyDown={event => moveFocus(event, r, c, definition.size, definition.size)} aria-label={`Row ${r + 1}, column ${c + 1}${definition.givens[r][c] ? ', printed number' : ''}`} className={`aspect-square w-full min-w-0 rounded-none border border-stone-300 text-center text-[clamp(0.75rem,4vw,1.125rem)] focus:z-10 focus:outline-emerald-600 ${locked ? 'opacity-60' : ''} ${definition.givens[r][c] ? 'bg-stone-200 font-bold text-stone-900' : 'bg-white text-emerald-900'}`} style={{ borderRightWidth: (c + 1) % box.columns === 0 ? 2 : 1, borderBottomWidth: (r + 1) % box.rows === 0 ? 2 : 1, borderRightColor: (c + 1) % box.columns === 0 ? '#44403c' : undefined, borderBottomColor: (r + 1) % box.rows === 0 ? '#44403c' : undefined }} onChange={event => {
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
  const cellsByEntry = new Map<string, { row: number; column: number }[]>()
  const entriesByCell = new Map<string, typeof definition.entries>()
  definition.entries.forEach((entry, index) => {
    const key = `${entry.row}:${entry.column}`
    if (!starts.has(key)) starts.set(key, index + 1)
    const cells: { row: number; column: number }[] = []
    for (let i = 0; i < entry.length; i++) {
      const cell = `${entry.row + (entry.direction === 'down' ? i : 0)}:${entry.column + (entry.direction === 'across' ? i : 0)}`
      occupied.add(cell)
      cells.push({ row: entry.row + (entry.direction === 'down' ? i : 0), column: entry.column + (entry.direction === 'across' ? i : 0) })
      entriesByCell.set(cell, [...(entriesByCell.get(cell) || []), entry])
    }
    cellsByEntry.set(entry.id, cells)
  })
  const dense = definition.columns > 10
  const expandedWidth = definition.columns * 44 + Math.max(0, definition.columns - 1) + 2
  const activeEntry = definition.entries.find(entry => entry.id === activeEntryId) || definition.entries[0]
  const crosswordLocked = disabled && !save.saving
  const focusCell = (row: number, column: number) => {
    window.setTimeout(() => {
      const cell = gridRef.current?.querySelector<HTMLInputElement>(`input[data-row="${row}"][data-column="${column}"]`)
      if (cell) { cell.focus(); cell.select() }
    }, 0)
  }
  const selectEntry = (entryId: string, row?: number, column?: number) => {
    const entry = definition.entries.find(candidate => candidate.id === entryId)
    if (!entry) return
    setActiveEntryId(entry.id)
    const target = row === undefined || column === undefined ? { row: entry.row, column: entry.column } : { row, column }
    setActiveCell(`${target.row}:${target.column}`)
  }
  const moveWithinEntry = (entryId: string, row: number, column: number, offset: number) => {
    const cells = cellsByEntry.get(entryId) || []
    const index = cells.findIndex(cell => cell.row === row && cell.column === column)
    const target = cells[index + offset]
    if (!target) return
    selectEntry(entryId, target.row, target.column)
    focusCell(target.row, target.column)
  }
  const selectCell = (row: number, column: number, toggle = false) => {
    const key = `${row}:${column}`
    const candidates = entriesByCell.get(key) || []
    if (!candidates.length) return
    const current = candidates.find(entry => entry.id === activeEntry?.id)
    const next = toggle && current ? candidates.find(entry => entry.id !== current.id) || current : current || candidates[0]
    selectEntry(next.id, row, column)
  }
  const moveGrid = (row: number, column: number, rowStep: number, columnStep: number) => {
    for (let r = row + rowStep, c = column + columnStep; r >= 0 && c >= 0 && r < definition.rows && c < definition.columns; r += rowStep, c += columnStep) {
      const candidates = entriesByCell.get(`${r}:${c}`)
      if (!candidates?.length) continue
      const intendedDirection = rowStep === 0 ? 'across' : 'down'
      selectEntry((candidates.find(entry => entry.direction === intendedDirection) || candidates[0]).id, r, c)
      focusCell(r, c)
      return
    }
  }

  return <div>
    <p className="mb-3 text-sm text-stone-600">Choose a clue or a square, then type continuously. The highlighted answer controls where letters go next; tap the same crossing square to switch Across and Down.</p>
    {activeEntry && <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p><strong>{starts.get(`${activeEntry.row}:${activeEntry.column}`)} {activeEntry.direction}</strong> · {activeEntry.clue}</p><span className="shrink-0 rounded-full bg-white px-2 py-1 text-xs font-bold capitalize">{activeEntry.direction}</span></div>}
    {dense && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
      <p className="min-w-0 flex-1">Large crossword: {enlarged ? 'swipe inside the grid to pan between easier-to-tap boxes.' : 'the whole board is fitted to the screen, so boxes are smaller.'}</p>
      <button type="button" aria-pressed={enlarged} onClick={() => setEnlarged(value => !value)} className="min-h-11 rounded-lg border border-sky-700 bg-white px-3 font-semibold">{enlarged ? 'Fit whole grid' : 'Enlarge grid'}</button>
    </div>}
    <div role={enlarged ? 'region' : undefined} aria-label={enlarged ? 'Scrollable crossword grid' : undefined} tabIndex={enlarged ? 0 : undefined} className={enlarged ? 'max-h-[70vh] overflow-auto overscroll-contain rounded border border-stone-300' : ''}>
      <div ref={gridRef} data-puzzle-grid role="group" aria-label="Crossword puzzle grid" aria-busy={save.pending} className={`grid touch-manipulation gap-px bg-stone-600 p-px ${enlarged ? '' : 'mx-auto w-full max-w-md'}`} style={{ gridTemplateColumns: `repeat(${definition.columns}, minmax(0, 1fr))`, ...(enlarged ? { width: `${expandedWidth}px` } : {}) }}>
        {save.draft.flatMap((row, r) => row.map((cell, c) => {
          const key = `${r}:${c}`
          if (!occupied.has(key)) return <div key={key} aria-hidden="true" className="aspect-square min-h-0 min-w-0 bg-stone-800" />
          const candidates = entriesByCell.get(key) || []
          const inActiveEntry = candidates.some(entry => entry.id === activeEntry?.id)
          const isActiveCell = activeCell === key
          return <label key={key} className={`relative aspect-square min-h-0 min-w-0 ${isActiveCell ? 'z-10 bg-amber-100 ring-2 ring-amber-500' : inActiveEntry ? 'bg-sky-100' : 'bg-white'}`}>
            {starts.has(key) && <span aria-hidden="true" className="pointer-events-none absolute left-0.5 top-0 text-[clamp(0.35rem,1.7vw,0.625rem)] font-semibold leading-none">{starts.get(key)}</span>}
            <input data-row={r} data-column={c} value={cell} maxLength={1} autoCapitalize="characters" autoComplete="off" readOnly={crosswordLocked} onFocus={event => { selectCell(r, c); event.currentTarget.select() }} onClick={() => selectCell(r, c, activeCell === key)} onBlur={() => { void save.flush() }} onKeyDown={event => {
              if (event.key === 'Backspace' && !cell && activeEntry) { event.preventDefault(); moveWithinEntry(activeEntry.id, r, c, -1); return }
              const direction: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
              const step = direction[event.key]
              if (step) { event.preventDefault(); moveGrid(r, c, step[0], step[1]) }
            }} aria-label={`Row ${r + 1}, column ${c + 1}${starts.has(key) ? `, clue ${starts.get(key)}` : ''}`} className={`h-full w-full min-w-0 appearance-none bg-transparent pt-[12%] text-center text-[clamp(0.6rem,4vw,1.125rem)] uppercase leading-none text-emerald-950 focus:outline-emerald-600 ${crosswordLocked ? 'opacity-60' : ''}`} onChange={event => {
              if (crosswordLocked) return
              const value = event.target.value.toUpperCase()
              if (!/^[A-Z]?$/.test(value)) return
              selectCell(r, c)
              save.change(r, c, value)
              const selected = (entriesByCell.get(key) || []).find(entry => entry.id === activeEntry?.id) || (entriesByCell.get(key) || [])[0]
              if (value && selected) moveWithinEntry(selected.id, r, c, 1)
            }} />
          </label>
        }))}
      </div>
    </div>
    <div className="mt-5 grid gap-5 text-sm sm:grid-cols-2">{(['across', 'down'] as const).map(direction => {
      const headingId = `${instanceId}-crossword-${direction}`
      return <section key={direction} aria-labelledby={headingId}><h3 id={headingId} className="mb-2 font-bold capitalize">{direction}</h3><ol className="space-y-2">{definition.entries.filter(entry => entry.direction === direction).map(entry => {
        const clueNumber = starts.get(`${entry.row}:${entry.column}`)
        const active = activeEntry?.id === entry.id
        return <li key={entry.id}><button type="button" aria-pressed={active} className={`w-full rounded-lg px-2 py-1 text-left leading-relaxed ${active ? 'bg-sky-100 font-semibold text-sky-950 ring-1 ring-sky-400' : 'hover:bg-stone-100'}`} onClick={() => { selectEntry(entry.id); focusCell(entry.row, entry.column) }}><strong>{clueNumber}.</strong> {entry.clue}</button></li>
      })}</ol></section>
    })}</div>
    <PuzzleSaveMessage busy={save.pending} error={save.error} />
  </div>
}
