'use client'

import { useRef, useState } from 'react'
import type { PuzzlePublicDefinition, PuzzleState } from '@/lib/engine/puzzles/types'
import type { ActionNotice } from '../player/ActionFeedback'

export interface PuzzlePlayerProps {
  definition: PuzzlePublicDefinition
  state: PuzzleState
  disabled: boolean
  draftKey?: string
  feedback?: ActionNotice | null
  clearFeedback?: () => void
  onChange: (submission: unknown) => Promise<void>
}
export const puzzleTileButton = 'min-h-12 rounded-xl border border-emerald-800 px-4 py-3 text-sm font-semibold text-emerald-900 disabled:opacity-50'
export const puzzleButton = `hunt-action ${puzzleTileButton}`
export const puzzleInput = 'min-h-12 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 focus:outline-emerald-700 disabled:opacity-60'

export function usePuzzleSubmission(onChange: PuzzlePlayerProps['onChange']) {
  const sending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (value: unknown) => {
    if (sending.current) return false
    sending.current = true
    setBusy(true)
    setError('')
    try { await onChange(value); return true }
    catch { setError('This move could not be saved. Check your connection and use Retry to recover it.'); return false }
    finally { sending.current = false; setBusy(false) }
  }
  return { submit, busy, error }
}

export function PuzzleSaveMessage({ busy, error }: { busy: boolean; error: string }) {
  return <p role={error ? 'alert' : 'status'} className={`mt-3 text-sm ${error ? 'text-amber-900' : 'text-stone-600'}`}>{error || (busy ? 'Saving your move…' : 'Your team shares this puzzle. Moves are checked and saved as you play.')}</p>
}
