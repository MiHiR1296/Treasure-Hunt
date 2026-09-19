'use client'

import { useEffect, useState } from 'react'
import type { QuarterTurn } from '@/lib/engine/puzzles/types'
import { PuzzleSaveMessage, puzzleTileButton, usePuzzleSubmission, type PuzzlePlayerProps } from './shared'

export default function TilePuzzles({ definition, state, disabled, onChange }: PuzzlePlayerProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const { submit, busy, error } = usePuzzleSubmission(onChange)
  useEffect(() => { setSelected(null) }, [state])
  const locked = disabled || busy
  if (definition.type === 'jigsaw' && state.type === 'jigsaw') {
    const swap = (index: number) => {
      if (locked) return
      if (selected === null) { setSelected(index); return }
      if (selected === index) { setSelected(null); return }
      const order = [...state.order]
      ;[order[selected], order[index]] = [order[index], order[selected]]
      setSelected(null)
      void submit({ order })
    }
    return <div>
      <p className="mb-3 text-sm text-stone-600">Put the picture together. Tap one tile, then another to swap them.</p>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${definition.columns}, minmax(0, 1fr))` }}>
        {state.order.map((id, index) => {
          const piece = definition.pieces.find(candidate => candidate.id === id)
          if (!piece) return null
          return <button type="button" key={index} onClick={() => swap(index)} disabled={locked} aria-pressed={selected === index} aria-label={`Tile in row ${Math.floor(index / definition.columns) + 1}, column ${index % definition.columns + 1}${piece.alt ? `: ${piece.alt}` : ''}${selected === index ? ', selected' : ''}`} className={`relative aspect-square min-h-11 overflow-hidden rounded border-4 ${selected === index ? 'border-amber-500' : 'border-transparent'} disabled:opacity-60`}>
            {/* Tiles are pre-cut assets; crop coordinates and solution order stay server-side. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img draggable={false} src={piece.imageUrl} alt={piece.alt || 'Image puzzle tile'} className="h-full w-full object-cover" />
            {selected === index && <span className="absolute inset-x-0 bottom-0 bg-amber-100 text-xs font-bold text-amber-950">Selected</span>}
          </button>
        })}
      </div>
      <PuzzleSaveMessage busy={busy} error={error} />
    </div>
  }
  if (definition.type !== 'rotation' || state.type !== 'rotation') return null
  return <div>
    <p className="mb-3 text-sm text-stone-600">Rotate each picture tile until the scene is aligned. Each tap turns a tile clockwise.</p>
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${definition.columns}, minmax(0, 1fr))` }}>
      {definition.tiles.map((tile, index) => <button type="button" key={tile.id} className={`${puzzleTileButton} overflow-hidden p-1`} disabled={locked} aria-label={`Rotate tile ${index + 1} clockwise${tile.alt ? `: ${tile.alt}` : ''}; currently ${state.rotations[tile.id]} degrees`} onClick={() => void submit({ rotations: { ...state.rotations, [tile.id]: (state.rotations[tile.id] + 90) % 360 as QuarterTurn } })}>
        <div className="aspect-square overflow-hidden rounded">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={tile.imageUrl} alt={tile.alt || `Tile ${index + 1}`} draggable={false} style={{ transform: `rotate(${state.rotations[tile.id]}deg)` }} className="h-full w-full object-cover" />
        </div>
        <span className="mt-1 block text-xs">↻ {state.rotations[tile.id]}°</span>
      </button>)}
    </div>
    <PuzzleSaveMessage busy={busy} error={error} />
  </div>
}
