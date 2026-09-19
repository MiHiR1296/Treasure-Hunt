'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { savedDraft, storeDraft } from '../sessionClient'
import { PuzzleSaveMessage, puzzleButton, puzzleInput, usePuzzleSubmission, type PuzzlePlayerProps } from './shared'

export default function ChoicePuzzles({ definition, state, disabled, onChange, draftKey, feedback, clearFeedback }: PuzzlePlayerProps) {
  const [answer, setAnswer] = useState(state.type === 'text' ? state.value : '')
  const { submit, busy, error } = usePuzzleSubmission(onChange)
  useEffect(() => {
    if (state.type === 'text') {
      const local = draftKey ? savedDraft<string>(draftKey) : null
      setAnswer(typeof local === 'string' ? local : state.value)
    }
  }, [state, draftKey])
  const locked = disabled || busy
  if (definition.type === 'text' && state.type === 'text') {
    const check = (event: FormEvent) => { event.preventDefault(); if (!locked && answer.trim()) void submit({ value: answer }) }
    return <form onSubmit={check} className="space-y-3">
      <p className="whitespace-pre-wrap leading-relaxed">{definition.prompt}</p>
      <label className="block text-sm font-semibold">Your answer<input value={answer} onChange={event => { setAnswer(event.target.value); clearFeedback?.(); if (draftKey) storeDraft(draftKey, event.target.value) }} readOnly={locked} aria-invalid={feedback?.kind === 'error' || undefined} aria-describedby={feedback?.id} autoComplete="off" maxLength={2048} className={`${puzzleInput} mt-2 w-full`} /></label>
      <button type="submit" disabled={locked || !answer.trim()} className={`${puzzleButton} w-full`}>Check answer</button>
      <PuzzleSaveMessage busy={busy} error={error} />
    </form>
  }
  if (definition.type === 'multiple_choice' && state.type === 'multiple_choice') return <div className="space-y-3">
    <p className="whitespace-pre-wrap leading-relaxed">{definition.prompt}</p>
    {definition.options.map(option => <button type="button" key={option.id} disabled={locked} aria-pressed={state.optionId === option.id} onClick={() => void submit({ optionId: option.id })} className={`${puzzleButton} w-full text-left ${state.optionId === option.id ? 'bg-emerald-50 ring-2 ring-emerald-700' : 'bg-white'}`}>{state.optionId === option.id ? 'Selected: ' : ''}{option.label}</button>)}
    <PuzzleSaveMessage busy={busy} error={error} />
  </div>
  if (definition.type === 'matching' && state.type === 'matching') return <div className="space-y-3">
    <p className="text-sm text-stone-600">Match every item with its partner. You can change a match until the whole set is correct.</p>
    {definition.left.map(item => <label key={item.id} className="block rounded-xl border border-stone-200 bg-white p-3 text-sm font-semibold">{item.label}
      <select className={`${puzzleInput} mt-2 w-full`} value={state.pairs.find(pair => pair.leftId === item.id)?.rightId || ''} disabled={locked} onChange={event => {
        const rightId = event.target.value
        const pairs = state.pairs.filter(pair => pair.leftId !== item.id && pair.rightId !== rightId)
        if (rightId) pairs.push({ leftId: item.id, rightId })
        void submit({ pairs })
      }}>
        <option value="">Choose a partner</option>
        {definition.right.map(right => <option key={right.id} value={right.id}>{right.label}{state.pairs.some(pair => pair.rightId === right.id && pair.leftId !== item.id) ? ' (moves from another match)' : ''}</option>)}
      </select>
    </label>)}
    <PuzzleSaveMessage busy={busy} error={error} />
  </div>
  if (definition.type !== 'sequence' || state.type !== 'sequence') return null
  const move = (from: number, to: number) => {
    if (locked || to < 0 || to >= state.order.length) return
    const order = [...state.order]
    ;[order[from], order[to]] = [order[to], order[from]]
    void submit({ order })
  }
  return <div>
    <p className="mb-3 text-sm text-stone-600">Put these items in the correct order. Use the arrows to move an item.</p>
    <ol className="space-y-2">{state.order.map((id, index) => {
      const item = definition.items.find(candidate => candidate.id === id)
      return <li key={id} className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white p-2"><span className="w-7 shrink-0 text-center text-sm font-bold text-stone-500">{index + 1}</span><span className="min-w-0 flex-1 text-sm">{item?.label}</span><button type="button" disabled={locked || index === 0} aria-label={`Move ${item?.label} up`} onClick={() => move(index, index - 1)} className={`${puzzleButton} px-3`}>↑</button><button type="button" disabled={locked || index === state.order.length - 1} aria-label={`Move ${item?.label} down`} onClick={() => move(index, index + 1)} className={`${puzzleButton} px-3`}>↓</button></li>
    })}</ol>
    <PuzzleSaveMessage busy={busy} error={error} />
  </div>
}
