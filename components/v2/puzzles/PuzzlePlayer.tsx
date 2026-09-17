'use client'

import dynamic from 'next/dynamic'
import type { PuzzlePlayerProps } from './shared'

const loading = () => <p role="status">Opening your puzzle…</p>
const TilePuzzles = dynamic(() => import('./TilePuzzles'), { loading })
const GridPuzzles = dynamic(() => import('./GridPuzzles'), { loading })
const WordSearch = dynamic(() => import('./WordSearch'), { loading })
const ChoicePuzzles = dynamic(() => import('./ChoicePuzzles'), { loading })

/** The same player renders checkpoint puzzles and puzzles which reveal purchased hints. */
export default function PuzzlePlayer(props: PuzzlePlayerProps) {
  if (props.definition.type !== props.state.type) return <p role="alert">This puzzle needs to be refreshed. Ask the organizer for help if it continues.</p>
  switch (props.definition.type) {
    case 'jigsaw': case 'rotation': return <TilePuzzles {...props} />
    case 'sudoku': case 'crossword': return <GridPuzzles {...props} />
    case 'word_search': return <WordSearch {...props} />
    default: return <ChoicePuzzles {...props} />
  }
}

export type { PuzzlePlayerProps } from './shared'
