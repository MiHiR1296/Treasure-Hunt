'use client'

import { useEffect, useState } from 'react'
import type { GeneratedPuzzle, PuzzleDifficulty } from '@/lib/engine/puzzles/generator'
import type { PuzzleDefinition, SudokuSize } from '@/lib/engine/puzzles/types'
import { useBuilderMedia } from './AssetField'
import { actionClass, buttonClass, Field, inputClass, NumberField } from './Fields'
import { selectGeneratedPuzzle } from './puzzleGeneratorModel'

type GeneratedType = Extract<PuzzleDefinition, { type: 'word_search' | 'sudoku' | 'crossword' }>

function AnswerKey({ generated }: { generated: GeneratedPuzzle }) {
  if (generated.answerKey.type === 'sudoku') return <pre className="overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">{generated.answerKey.solution.map(row => row.join(' ')).join('\n')}</pre>
  if (generated.answerKey.type === 'word_search') return <ul className="space-y-1 text-xs text-slate-700">{generated.answerKey.paths.map(path => <li key={path.word}><strong>{path.word}</strong>: {path.cells.map(cell => `(${cell.row + 1},${cell.column + 1})`).join(' → ')}</li>)}</ul>
  return <ul className="space-y-1 text-xs text-slate-700">{generated.answerKey.entries.map(entry => <li key={entry.id}><strong>{entry.answer}</strong>: row {entry.row + 1}, column {entry.column + 1}, {entry.direction}</li>)}</ul>
}

/** Creates verified draft candidates; selecting one saves only the normal private puzzle definition. */
export default function PuzzleGenerator({ value, onChange }: { value: GeneratedType; onChange: (value: PuzzleDefinition) => void }) {
  const media = useBuilderMedia()
  const editorSize = value.type === 'sudoku' ? value.size : null
  const editorRows = value.type === 'word_search' ? value.grid.length : value.type === 'crossword' ? value.rows : null
  const editorColumns = value.type === 'word_search' ? value.grid[0]?.length || 0 : value.type === 'crossword' ? value.columns : null
  const minimumDimension = value.type === 'crossword' ? 3 : 4
  const [difficulty, setDifficulty] = useState<PuzzleDifficulty>('medium')
  const [variants, setVariants] = useState(4)
  const [rows, setRows] = useState(value.type === 'word_search' || value.type === 'crossword' ? value.type === 'word_search' ? Math.max(4, value.grid.length) : Math.max(3, value.rows) : 12)
  const [columns, setColumns] = useState(value.type === 'word_search' || value.type === 'crossword' ? value.type === 'word_search' ? Math.max(4, value.grid[0]?.length || 0) : Math.max(3, value.columns) : 12)
  const [size, setSize] = useState<SudokuSize>(value.type === 'sudoku' ? value.size : 9)
  const [seed, setSeed] = useState('')
  const [generated, setGenerated] = useState<GeneratedPuzzle[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (editorSize !== null) setSize(editorSize)
    if (editorRows !== null && editorColumns !== null) { setRows(Math.max(minimumDimension, editorRows)); setColumns(Math.max(minimumDimension, editorColumns)) }
  }, [editorSize, editorRows, editorColumns, minimumDimension])

  async function generate() {
    if (!media?.generatePuzzles || busy) return
    setBusy(true); setError(''); setGenerated([])
    try {
      const repeat = seed.trim() ? { seed: seed.trim() } : {}
      const input = value.type === 'word_search'
        ? { type: 'word_search' as const, rows, columns, words: value.words, minimumWords: value.minimumWords, bonusPerExtraWord: value.bonusPerExtraWord, difficulty, variants, ...repeat }
        : value.type === 'sudoku'
          ? { type: 'sudoku' as const, size, difficulty, variants, ...repeat }
          : { type: 'crossword' as const, rows, columns, entries: value.entries.map(({ id, clue, answer }) => ({ id, clue, answer })), variants, ...repeat }
      setGenerated(await media.generatePuzzles(input))
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The puzzle generator could not create a layout. Please try again.') }
    finally { setBusy(false) }
  }

  const title = value.type === 'word_search' ? 'Word-search generator' : value.type === 'sudoku' ? 'Sudoku generator' : 'Crossword generator'
  const description = value.type === 'word_search'
    ? 'Enter the words below, then generate complete grids with every word placed.'
    : value.type === 'sudoku'
      ? 'Generate a uniquely solvable board. Difficulty controls how many starting numbers are shown.'
      : 'Enter each answer and clue below, then generate a connected layout with shared letters.'

  return <section className="space-y-3 rounded-lg border border-teal-200 bg-teal-50/60 p-4">
    <div><h3 className="font-semibold text-teal-950">{title}</h3><p className="mt-1 text-sm leading-6 text-teal-950">{description}</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      {value.type !== 'sudoku' && <><NumberField label="Rows" value={rows} min={value.type === 'crossword' ? 3 : 4} max={25} onChange={setRows} /><NumberField label="Columns" value={columns} min={value.type === 'crossword' ? 3 : 4} max={25} onChange={setColumns} /></>}
      {value.type === 'sudoku' && <Field label="Board size"><select className={inputClass} value={size} onChange={event => setSize(Number(event.target.value) as SudokuSize)}><option value={4}>4 × 4</option><option value={6}>6 × 6</option><option value={9}>9 × 9</option></select></Field>}
      {value.type !== 'crossword' && <Field label="Difficulty"><select className={inputClass} value={difficulty} onChange={event => setDifficulty(event.target.value as PuzzleDifficulty)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></Field>}
      <NumberField label="Alternatives to create" value={variants} min={1} max={4} onChange={setVariants} hint="Create up to four candidate versions for testing or different random routes." />
      <Field label="Reproducibility seed" hint="Optional. Reuse a seed to reproduce the same candidates."><input className={inputClass} value={seed} maxLength={96} placeholder="e.g. learning-trail-v1" onChange={event => setSeed(event.target.value)} /></Field>
    </div>
    {!media?.generatePuzzles && <p className="text-sm text-amber-800">Puzzle generation is available in the organiser workspace.</p>}
    <button type="button" className={actionClass} disabled={!media?.generatePuzzles || busy} onClick={() => void generate()}>{busy ? 'Generating and verifying…' : `Generate ${variants} ${variants === 1 ? 'version' : 'versions'}`}</button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {generated.length > 0 && <div className="space-y-3 border-t border-teal-200 pt-3"><p className="text-sm leading-6 text-teal-950">Every candidate was validated server-side. Choose one to replace the manual layout; its answer key is not saved into the hunt export.</p>{generated.map((candidate, index) => <article key={candidate.seed} className="rounded-lg border border-teal-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-900">Version {index + 1} · {candidate.metrics.label}</p><button type="button" className={buttonClass} onClick={() => onChange(selectGeneratedPuzzle(value, candidate.puzzle))}>Use this version</button></div><p className="mt-1 text-xs text-slate-600">{candidate.metrics.detail} · seed {candidate.seed}</p><details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-teal-900">Organizer answer key</summary><div className="mt-2"><AnswerKey generated={candidate} /></div></details></article>)}</div>}
  </section>
}
