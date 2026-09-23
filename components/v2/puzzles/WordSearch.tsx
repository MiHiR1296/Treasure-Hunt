'use client'

import { useState } from 'react'
import type { Cell } from '@/lib/engine/puzzles/types'
import { PuzzleSaveMessage, usePuzzleSubmission, type PuzzlePlayerProps } from './shared'

export default function WordSearch({ definition, state, disabled, onChange }: PuzzlePlayerProps) {
  const [start, setStart] = useState<Cell | null>(null)
  const [message, setMessage] = useState('')
  const { submit, busy, error } = usePuzzleSubmission(onChange)
  if (definition.type !== 'word_search' || state.type !== 'word_search') return null
  const minimumWords = definition.minimumWords ?? definition.words.length
  const bonus = definition.bonusPerExtraWord ?? 0
  const select = (end: Cell) => {
    if (disabled || busy) return
    if (!start) { setStart(end); setMessage('Now select the last letter of the word.'); return }
    const rowDistance = end.row - start.row
    const columnDistance = end.column - start.column
    if (rowDistance && columnDistance && Math.abs(rowDistance) !== Math.abs(columnDistance)) { setStart(end); setMessage('Words follow a straight line. New starting letter selected.'); return }
    const length = Math.max(Math.abs(rowDistance), Math.abs(columnDistance)) + 1
    const path = Array.from({ length }, (_, index) => ({ row: start.row + Math.sign(rowDistance) * index, column: start.column + Math.sign(columnDistance) * index }))
    const letters = path.map(cell => definition.grid[cell.row][cell.column]).join('')
    const matches = definition.words.some(word => word === letters || word === [...letters].reverse().join(''))
    setMessage(matches ? `Checking ${letters}…` : `${letters} is not a listed word. Keep looking.`)
    setStart(null)
    void submit({ path })
  }
  return <div>
    <p className="mb-1 text-sm font-semibold text-stone-800">Find at least {minimumWords} of {definition.words.length} ingredients.</p>
    <p className="mb-3 text-sm text-stone-600">Words may run forward, backward, up, down, or diagonally.{bonus > 0 && minimumWords < definition.words.length ? ` Each extra ingredient is worth +${bonus} points.` : ''}</p>
    <section aria-labelledby="word-search-tutorial" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <h3 id="word-search-tutorial" className="font-bold">How to select a word</h3>
      <ol className="mt-2 grid gap-2 sm:grid-cols-3">
        <li className="flex gap-2"><span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-200 font-bold">1</span><span>Choose a word from the list.</span></li>
        <li className="flex gap-2"><span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-200 font-bold">2</span><span>Tap its first letter in the grid.</span></li>
        <li className="flex gap-2"><span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-200 font-bold">3</span><span>Tap its last letter to check it.</span></li>
      </ol>
    </section>
    <ul aria-label="Words to find" className="mb-4 flex flex-wrap gap-2">{definition.words.map(word => <li key={word} className={`rounded-lg px-3 py-2 text-sm font-semibold ${state.foundWords.includes(word) ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-100 text-stone-700'}`}>{state.foundWords.includes(word) ? `✓ ${word} found` : word}</li>)}</ul>
    <div role="group" aria-label="Word search puzzle grid" className="mx-auto grid w-full max-w-lg touch-manipulation gap-0.5 sm:gap-1" style={{ gridTemplateColumns: `repeat(${definition.grid[0].length}, minmax(0, 1fr))` }}>
      {definition.grid.flatMap((row, r) => row.map((letter, c) => <button key={`${r}:${c}`} type="button" disabled={disabled || busy} aria-label={`${letter}, row ${r + 1}, column ${c + 1}`} aria-pressed={start?.row === r && start.column === c} onClick={() => select({ row: r, column: c })} className={`aspect-square min-w-0 rounded-[clamp(0.2rem,1.5vw,0.5rem)] border p-0 text-[clamp(0.55rem,3.5vw,1rem)] font-bold disabled:opacity-50 ${start?.row === r && start.column === c ? 'border-amber-600 bg-amber-100 text-amber-950 ring-2 ring-amber-400' : 'border-stone-300 bg-white text-stone-900'}`}>{letter}</button>))}
    </div>
    {state.foundWords.length >= minimumWords && state.foundWords.length < definition.words.length && <button type="button" disabled={disabled || busy} onClick={() => void submit({ finish: true })} className="hunt-action mt-4 min-h-12 w-full rounded-xl border border-emerald-800 px-4 py-3 font-semibold text-emerald-900 disabled:opacity-50">Continue with {state.foundWords.length} ingredients</button>}
    {message && <p role="status" className="mt-3 text-sm text-stone-700">{message}</p>}
    <PuzzleSaveMessage busy={busy} error={error} />
  </div>
}
