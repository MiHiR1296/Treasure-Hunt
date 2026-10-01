import type { GeneratedPuzzle, PuzzleDifficulty, PuzzleGenerationInput } from '@/lib/engine/puzzles/generator'
import type { PuzzleDefinition, SudokuSize } from '@/lib/engine/puzzles/types'
import { validatePuzzle } from '@/lib/engine/puzzles/validation'

type GeneratedPuzzleDefinition = GeneratedPuzzle['puzzle']
export type GeneratorPuzzleDefinition = Extract<PuzzleDefinition, { type: 'word_search' | 'sudoku' | 'crossword' }>
export type GeneratorSettings = { rows: number; columns: number; size: SudokuSize; difficulty: PuzzleDifficulty; variants: number; seed: string }

export function puzzleGenerationInput(value: GeneratorPuzzleDefinition, settings: GeneratorSettings): PuzzleGenerationInput {
  const seed = settings.seed.trim()
  const repeat = seed ? { seed } : {}
  if (value.type === 'word_search') return { type: 'word_search', rows: settings.rows, columns: settings.columns, words: value.words, minimumWords: value.minimumWords, bonusPerExtraWord: value.bonusPerExtraWord, difficulty: settings.difficulty, variants: settings.variants, ...repeat }
  if (value.type === 'sudoku') return { type: 'sudoku', size: settings.size, difficulty: settings.difficulty, variants: settings.variants, ...repeat }
  return { type: 'crossword', rows: settings.rows, columns: settings.columns, entries: value.entries.map(({ id, clue, answer }) => ({ id, clue, answer })), variants: settings.variants, ...repeat }
}

/** A candidate may only be selected for the exact setup that produced it. */
export function puzzleGenerationKey(input: PuzzleGenerationInput) { return JSON.stringify(input) }

/**
 * Applies a generated layout without silently changing word-search progress
 * rules that the organiser configured in the normal puzzle editor.
 */
export function selectGeneratedPuzzle(current: PuzzleDefinition, generated: GeneratedPuzzleDefinition): PuzzleDefinition | null {
  const selected = current.type !== 'word_search' || generated.type !== 'word_search' ? generated : {
    ...generated,
    ...(current.minimumWords === undefined ? {} : { minimumWords: current.minimumWords }),
    ...(current.bonusPerExtraWord === undefined ? {} : { bonusPerExtraWord: current.bonusPerExtraWord }),
  }
  return validatePuzzle(selected).length ? null : selected
}
