'use client'

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { savedDraft, storeDraft } from '../sessionClient'
import { PuzzleSaveMessage, usePuzzleSubmission, type PuzzlePlayerProps } from './shared'

type CrosswordDefinition = Extract<PuzzlePlayerProps['definition'], { type: 'crossword' }>
type CrosswordEntry = CrosswordDefinition['entries'][number]

interface DraftState {
  scope: string | null
  answers: Record<string, string>
}

function normalizeAnswer(value: string, length: number): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/gi, '').toUpperCase().slice(0, length)
}

function restoredDrafts(value: unknown, entries: CrosswordDefinition['entries']): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const stored = value as Record<string, unknown>
  return Object.fromEntries(entries.flatMap(entry => {
    const answer = stored[entry.id]
    const normalized = typeof answer === 'string' ? normalizeAnswer(answer, entry.length) : ''
    return normalized ? [[entry.id, normalized]] : []
  }))
}

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

export default function GridPuzzles({ definition, state, disabled, onChange, draftScope }: PuzzlePlayerProps) {
  const instanceId = useId().replace(/:/g, '')
  const crosswordColumns = definition.type === 'crossword' ? definition.columns : 0
  const [draftState, setDraftState] = useState<DraftState>({ scope: null, answers: {} })
  const draftStateRef = useRef(draftState)
  const [enlarged, setEnlarged] = useState(crosswordColumns > 10)
  const { submit, busy, error } = usePuzzleSubmission(onChange)
  const locked = disabled || busy

  useEffect(() => {
    const scope = draftScope ?? null
    const answers = definition.type === 'crossword' && draftScope
      ? restoredDrafts(savedDraft<unknown>(draftScope), definition.entries)
      : {}
    const next = { scope, answers }
    draftStateRef.current = next
    setDraftState(next)
  }, [draftScope, definition])

  useEffect(() => {
    if (definition.type === 'crossword') setEnlarged(crosswordColumns > 10)
  }, [definition.type, crosswordColumns])

  const persistDrafts = (scope: string | null, answers: Record<string, string>) => {
    const next = { scope, answers }
    draftStateRef.current = next
    setDraftState(next)
    if (scope) storeDraft(scope, Object.keys(answers).length ? answers : null)
  }

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

  const scope = draftScope ?? null
  const draftAnswers = draftState.scope === scope ? draftState.answers : {}
  const occupied = new Set<string>()
  const starts = new Map<string, number>()
  definition.entries.forEach((entry, index) => {
    const key = `${entry.row}:${entry.column}`
    if (!starts.has(key)) starts.set(key, index + 1)
    for (let i = 0; i < entry.length; i++) occupied.add(`${entry.row + (entry.direction === 'down' ? i : 0)}:${entry.column + (entry.direction === 'across' ? i : 0)}`)
  })
  const entryCells = (entry: CrosswordEntry, grid = state.grid) => Array.from({ length: entry.length }, (_, index) => grid[entry.row + (entry.direction === 'down' ? index : 0)][entry.column + (entry.direction === 'across' ? index : 0)])
  const updateDraft = (entry: CrosswordEntry, raw: string) => {
    const current = draftStateRef.current.scope === scope ? draftStateRef.current.answers : {}
    const next = { ...current }
    const answer = normalizeAnswer(raw, entry.length)
    if (answer) next[entry.id] = answer
    else delete next[entry.id]
    persistDrafts(scope, next)
  }
  const placeAnswer = (event: FormEvent, entry: CrosswordEntry) => {
    event.preventDefault()
    const current = draftStateRef.current.scope === scope ? draftStateRef.current.answers : {}
    const value = current[entry.id] ?? ''
    if (locked || value.length !== entry.length) return
    const grid = state.grid.map(row => [...row])
    for (let index = 0; index < entry.length; index++) grid[entry.row + (entry.direction === 'down' ? index : 0)][entry.column + (entry.direction === 'across' ? index : 0)] = value[index]
    const submittedScope = scope
    void submit({ grid }).then(saved => {
      if (!saved || draftStateRef.current.scope !== submittedScope || draftStateRef.current.answers[entry.id] !== value) return
      const next = { ...draftStateRef.current.answers }
      delete next[entry.id]
      persistDrafts(submittedScope, next)
    })
  }
  const dense = definition.columns > 10
  const expandedWidth = definition.columns * 44 + Math.max(0, definition.columns - 1) + 2

  return <div>
    <p className="mb-3 text-sm text-stone-600">Type a whole answer under its clue, then place it in the boxes. You can still edit individual boxes; arrow keys move between them.</p>
    {dense && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
      <p className="min-w-0 flex-1">Large crossword: {enlarged ? 'swipe inside the grid to pan between easier-to-tap boxes.' : 'the whole board is fitted to the screen; use clue inputs for easier entry.'}</p>
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
    <div className="mt-5 space-y-5 text-sm">{(['across', 'down'] as const).map(direction => {
      const headingId = `${instanceId}-crossword-${direction}`
      return <section key={direction} aria-labelledby={headingId}><h3 id={headingId} className="mb-2 font-bold capitalize">{direction}</h3><div className="space-y-3">{definition.entries.filter(entry => entry.direction === direction).map(entry => {
        const clueNumber = starts.get(`${entry.row}:${entry.column}`)
        const answer = draftAnswers[entry.id] ?? ''
        const cells = entryCells(entry)
        const inputId = `${instanceId}-crossword-answer-${entry.id}`
        const progressId = `${instanceId}-crossword-progress-${entry.id}`
        const draftId = `${instanceId}-crossword-draft-${entry.id}`
        return <form key={entry.id} onSubmit={event => placeAnswer(event, entry)} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
          <label htmlFor={inputId} className="block leading-relaxed"><strong>{clueNumber}.</strong> {entry.clue} ({entry.length})</label>
          <p id={progressId} aria-label={`Shared boxes: ${cells.map(letter => letter || 'blank').join(', ')}`} className="mt-1 text-xs text-stone-600">Shared boxes: <span aria-hidden="true" className="font-mono font-semibold tracking-widest text-stone-800">{cells.map(letter => letter || '_').join(' ')}</span></p>
          <div className="mt-2 flex flex-col gap-2 min-[380px]:flex-row">
            <input id={inputId} aria-label={`Answer for ${clueNumber} ${direction}`} aria-describedby={`${progressId}${answer ? ` ${draftId}` : ''}`} value={answer} maxLength={Math.min(256, Math.max(64, entry.length * 4))} autoCapitalize="characters" autoComplete="off" spellCheck={false} readOnly={locked} onPaste={event => {
              event.preventDefault()
              const start = event.currentTarget.selectionStart ?? answer.length
              const end = event.currentTarget.selectionEnd ?? start
              updateDraft(entry, `${answer.slice(0, start)}${event.clipboardData.getData('text')}${answer.slice(end)}`)
            }} onChange={event => updateDraft(entry, event.target.value)} className="min-h-12 min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base uppercase tracking-widest text-stone-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 read-only:opacity-60" placeholder={`Type ${entry.length} letters`} />
            <button type="submit" disabled={locked || answer.length !== entry.length} aria-label={`Place ${clueNumber} ${direction} in grid`} className="hunt-action min-h-12 rounded-lg border border-emerald-800 px-4 py-2 font-semibold text-emerald-900 disabled:opacity-50">Place in boxes</button>
          </div>
          {answer && <p id={draftId} role="status" className="mt-2 text-xs text-amber-800">Draft saved on this device ({answer.length}/{entry.length} letters). Place in boxes to share with your team.</p>}
        </form>
      })}</div></section>
    })}</div>
    <PuzzleSaveMessage busy={busy} error={error} />
  </div>
}
