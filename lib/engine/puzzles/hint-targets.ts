import type { PuzzleDefinition, PuzzleState } from './types'

export interface PuzzleHintItem { id: string; label: string }

/** Stable, author-facing targets for puzzles whose answers can be solved independently. */
export function puzzleHintItems(definition: PuzzleDefinition): PuzzleHintItem[] {
  if (definition.type === 'word_search') {
    const seen = new Set<string>()
    return definition.words.flatMap(word => {
      const id = word.normalize('NFKC').trim().toUpperCase()
      if (!id || seen.has(id)) return []
      seen.add(id)
      return [{ id, label: word }]
    })
  }
  if (definition.type === 'crossword') return definition.entries.map(entry => ({ id: entry.id, label: entry.clue }))
  return []
}

/** Server-side relevance check. It returns only a boolean to player projections. */
export function puzzleHintItemSolved(definition: PuzzleDefinition, state: PuzzleState | undefined, itemId: string): boolean {
  if (!state || definition.type !== state.type) return false
  if (definition.type === 'word_search' && state.type === 'word_search') {
    const target = itemId.normalize('NFKC').trim().toUpperCase()
    return state.foundWords.some(word => word.normalize('NFKC').trim().toUpperCase() === target)
  }
  if (definition.type === 'crossword' && state.type === 'crossword') {
    const entry = definition.entries.find(candidate => candidate.id === itemId)
    if (!entry) return false
    return [...entry.answer.toUpperCase()].every((letter, index) => {
      const row = entry.row + (entry.direction === 'down' ? index : 0)
      const column = entry.column + (entry.direction === 'across' ? index : 0)
      return state.grid[row]?.[column]?.toUpperCase() === letter
    })
  }
  return false
}
