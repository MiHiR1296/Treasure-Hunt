import type { GeneratedPuzzle } from '@/lib/engine/puzzles/generator'
import type { PuzzleDefinition } from '@/lib/engine/puzzles/types'

type GeneratedPuzzleDefinition = GeneratedPuzzle['puzzle']

/**
 * Applies a generated layout without silently changing word-search progress
 * rules that the organiser configured in the normal puzzle editor.
 */
export function selectGeneratedPuzzle(current: PuzzleDefinition, generated: GeneratedPuzzleDefinition): PuzzleDefinition {
  if (current.type !== 'word_search' || generated.type !== 'word_search') return generated
  return {
    ...generated,
    ...(current.minimumWords === undefined ? {} : { minimumWords: current.minimumWords }),
    ...(current.bonusPerExtraWord === undefined ? {} : { bonusPerExtraWord: current.bonusPerExtraWord }),
  }
}
