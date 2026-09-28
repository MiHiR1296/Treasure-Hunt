'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Cell } from '@/lib/engine/puzzles/types'
import { PuzzleSaveMessage, usePuzzleSubmission, type PuzzlePlayerProps } from './shared'
import { cellKey, findWordPath, lineBetween, wordForPath } from './word-search-paths'

export default function WordSearch({ definition, state, disabled, onChange }: PuzzlePlayerProps) {
  const [start, setStart] = useState<Cell | null>(null)
  const [preview, setPreview] = useState<Cell[]>([])
  const [message, setMessage] = useState('')
  const dense = definition.type === 'word_search' && definition.grid[0].length > 10
  const [enlarged, setEnlarged] = useState(dense)
  const [panMode, setPanMode] = useState(false)
  const drag = useRef<{ origin: Cell; path: Cell[]; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const selectedPaths = useRef(new Map<string, Cell[]>())
  const { submit, busy, error } = usePuzzleSubmission(onChange)
  useEffect(() => { setEnlarged(dense); setPanMode(false) }, [dense])
  if (definition.type !== 'word_search' || state.type !== 'word_search') return null
  const columns = definition.grid[0].length
  const minimumWords = definition.minimumWords ?? definition.words.length
  const bonus = definition.bonusPerExtraWord ?? 0
  const foundCells = new Set<string>()
  state.foundWords.forEach(word => (selectedPaths.current.get(word) ?? findWordPath(definition.grid, word)).forEach(cell => foundCells.add(cellKey(cell))))
  const submitPath = (path: Cell[]) => {
    if (disabled || busy || path.length < 2) return
    const letters = path.map(cell => definition.grid[cell.row]?.[cell.column] ?? '').join('')
    const matchedWord = wordForPath(definition.grid, path, definition.words)
    setMessage(`Checking ${letters}…`)
    setStart(null)
    setPreview([])
    void submit({ path }).then(saved => {
      if (saved && matchedWord) selectedPaths.current.set(matchedWord, path)
      setMessage(saved
        ? matchedWord ? `${matchedWord} found! It is now highlighted in the grid.` : `${letters} is not a listed word. Keep looking.`
        : `We could not confirm ${letters}. Try selecting it again.`)
    })
  }
  const select = (end: Cell) => {
    if (disabled || busy) return
    if (!start) { setStart(end); setPreview([end]); setMessage('Start selected. Tap the last letter, or drag across the word.'); return }
    const path = lineBetween(start, end)
    if (!path.length) { setStart(end); setPreview([end]); setMessage('Words follow a straight line. New starting letter selected.'); return }
    submitPath(path)
  }
  const pointerCell = (event: ReactPointerEvent<HTMLElement>) => {
    const grid = event.currentTarget.matches('[data-word-search-grid]') ? event.currentTarget : event.currentTarget.closest<HTMLElement>('[data-word-search-grid]')
    if (!grid) return null
    const bounds = grid.getBoundingClientRect()
    const row = Math.floor((event.clientY - bounds.top) / (bounds.height / definition.grid.length))
    const column = Math.floor((event.clientX - bounds.left) / (bounds.width / columns))
    if (!definition.grid[row]?.[column]) return null
    return { row, column }
  }
  const beginDrag = (cell: Cell, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || busy || panMode) return
    event.preventDefault()
    event.currentTarget.closest<HTMLElement>('[data-word-search-grid]')?.setPointerCapture(event.pointerId)
    drag.current = { origin: cell, path: [cell], moved: false }
    setStart(cell)
    setPreview([cell])
  }
  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return
    event.preventDefault()
    const end = pointerCell(event)
    if (!end) return
    const path = lineBetween(drag.current.origin, end, true).filter(cell => definition.grid[cell.row]?.[cell.column])
    if (!path.length) return
    drag.current = { ...drag.current, path, moved: drag.current.moved || path.length > 1 }
    setPreview(path)
  }
  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return
    event.preventDefault()
    suppressClick.current = true
    window.setTimeout(() => { suppressClick.current = false }, 0)
    const current = drag.current
    drag.current = null
    if (current.moved && current.path.length > 1) submitPath(current.path)
    else select(current.origin)
  }
  const cancelDrag = () => { drag.current = null; setPreview(start ? [start] : []) }
  const previewCells = new Set(preview.map(cellKey))
  const expandedWidth = columns * 44 + Math.max(0, columns - 1) * 2
  return <div>
    <p className="mb-1 text-sm font-semibold text-stone-800">Find at least {minimumWords} of {definition.words.length} ingredients.</p>
    <p className="mb-3 text-sm text-stone-600">Words may run forward, backward, up, down, or diagonally.{bonus > 0 && minimumWords < definition.words.length ? ` Each extra ingredient is worth +${bonus} points.` : ''}</p>
    <p id="word-search-instructions" role="note" className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold leading-relaxed text-amber-950 shadow-sm"><span className="font-extrabold">How to play:</span> Press the first letter, drag a straight line across the word, then release. You can also tap its first and last letters.</p>
    <ul aria-label="Words to find" className="mb-4 flex flex-wrap gap-2">{definition.words.map(word => <li key={word} className={`rounded-lg px-3 py-2 text-sm font-semibold ${state.foundWords.includes(word) ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-100 text-stone-700'}`}>{state.foundWords.includes(word) ? `✓ ${word} found` : word}</li>)}</ul>
    {dense && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
      <p className="min-w-0 flex-1">Large grid mode: {enlarged ? panMode ? 'Move mode is on. Swipe to reach another part of the grid.' : 'Select mode is on. Drag across letters to mark a word.' : 'the whole grid is fitted to the screen, so letters are smaller.'}</p>
      <div className="flex flex-wrap gap-2">
        {enlarged && <button type="button" aria-pressed={panMode} onClick={() => { setPanMode(value => !value); setStart(null); setPreview([]) }} className="min-h-11 rounded-lg border border-sky-700 bg-white px-3 font-semibold">{panMode ? 'Select words' : 'Move grid'}</button>}
        <button type="button" aria-pressed={enlarged} onClick={() => { setEnlarged(value => !value); setPanMode(false) }} className="min-h-11 rounded-lg border border-sky-700 bg-white px-3 font-semibold">{enlarged ? 'Fit whole grid' : 'Enlarge letters'}</button>
      </div>
    </div>}
    <div role={enlarged ? 'region' : undefined} aria-label={enlarged ? 'Scrollable word search' : undefined} tabIndex={enlarged ? 0 : undefined} className={enlarged ? 'max-h-[70vh] overflow-auto overscroll-contain rounded border border-stone-300' : ''}>
      <div data-word-search-grid role="group" aria-label="Word search puzzle grid" aria-describedby="word-search-instructions" aria-busy={busy} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} className={`grid gap-0.5 ${panMode ? 'touch-pan-x touch-pan-y' : 'touch-none select-none'} ${enlarged ? '' : 'mx-auto w-full max-w-lg'}`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, ...(enlarged ? { width: `${expandedWidth}px` } : {}) }}>
      {definition.grid.flatMap((row, r) => row.map((letter, c) => {
        const cell = { row: r, column: c }
        const key = cellKey(cell)
        const found = foundCells.has(key)
        const active = previewCells.has(key)
        return <button key={key} data-word-cell data-row={r} data-column={c} type="button" disabled={disabled || busy || panMode} aria-label={`${letter}, row ${r + 1}, column ${c + 1}${found ? ', found word' : ''}`} aria-pressed={found || active} onPointerDown={event => beginDrag(cell, event)} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return } select(cell) }} className={`aspect-square min-h-0 min-w-0 appearance-none overflow-hidden rounded-[clamp(0.2rem,1.5vw,0.5rem)] border p-0 ${enlarged ? 'text-base' : 'text-[clamp(0.5rem,3.5vw,1rem)]'} font-bold leading-none disabled:opacity-60 ${active ? 'relative z-10 border-amber-700 bg-amber-300 text-amber-950 ring-2 ring-inset ring-amber-600' : found ? 'border-emerald-700 bg-emerald-300 text-emerald-950 ring-1 ring-inset ring-emerald-700' : 'border-stone-300 bg-white text-stone-900'}`}>{letter}</button>
      }))}
      </div>
    </div>
    {state.foundWords.length >= minimumWords && state.foundWords.length < definition.words.length && <button type="button" disabled={disabled || busy} onClick={() => void submit({ finish: true })} className="hunt-action mt-4 min-h-12 w-full rounded-xl border border-emerald-800 px-4 py-3 font-semibold text-emerald-900 disabled:opacity-50">Continue with {state.foundWords.length} ingredients</button>}
    {message && <p role="status" className="mt-3 text-sm text-stone-700">{message}</p>}
    <PuzzleSaveMessage busy={busy} error={error} />
  </div>
}
