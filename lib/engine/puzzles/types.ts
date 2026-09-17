export interface PuzzleItem { id: string; label: string }
export interface ImagePiece { id: string; imageUrl: string; alt?: string }
export interface MatchingPair { leftId: string; rightId: string }
export interface Cell { row: number; column: number }
export type QuarterTurn = 0 | 90 | 180 | 270

export type PuzzleDefinition =
  | { type: 'jigsaw'; rows: number; columns: number; pieces: ImagePiece[]; solution: string[] }
  | { type: 'sudoku'; size: 4 | 9; givens: number[][] }
  | { type: 'word_search'; grid: string[][]; words: string[] }
  | { type: 'crossword'; rows: number; columns: number; entries: { id: string; clue: string; answer: string; row: number; column: number; direction: 'across' | 'down' }[] }
  | { type: 'rotation'; columns: number; tiles: (ImagePiece & { correctRotation: QuarterTurn })[] }
  | { type: 'text'; prompt: string; answers: string[]; caseSensitive?: boolean }
  | { type: 'multiple_choice'; prompt: string; options: PuzzleItem[]; correctOptionId: string }
  | { type: 'matching'; left: PuzzleItem[]; right: PuzzleItem[]; solution: MatchingPair[] }
  | { type: 'sequence'; items: PuzzleItem[]; solution: string[] }

export type PuzzlePublicDefinition =
  | { type: 'jigsaw'; rows: number; columns: number; pieces: ImagePiece[] }
  | { type: 'sudoku'; size: 4 | 9; givens: number[][] }
  | { type: 'word_search'; grid: string[][]; words: string[] }
  | { type: 'crossword'; rows: number; columns: number; entries: { id: string; clue: string; length: number; row: number; column: number; direction: 'across' | 'down' }[] }
  | { type: 'rotation'; columns: number; tiles: ImagePiece[] }
  | { type: 'text'; prompt: string }
  | { type: 'multiple_choice'; prompt: string; options: PuzzleItem[] }
  | { type: 'matching'; left: PuzzleItem[]; right: PuzzleItem[] }
  | { type: 'sequence'; items: PuzzleItem[] }

/** Player-entered state only. No answer keys, solution coordinates, or private metadata. */
export type PuzzleState =
  | { type: 'jigsaw'; order: string[] }
  | { type: 'sudoku'; grid: number[][] }
  | { type: 'word_search'; foundWords: string[] }
  | { type: 'crossword'; grid: string[][] }
  | { type: 'rotation'; rotations: Record<string, QuarterTurn> }
  | { type: 'text'; value: string }
  | { type: 'multiple_choice'; optionId: string | null }
  | { type: 'matching'; pairs: MatchingPair[] }
  | { type: 'sequence'; order: string[] }

export interface PuzzleUpdate { state: PuzzleState; completed: boolean }

export class PuzzleError extends Error {
  constructor(public readonly code: 'invalid_puzzle' | 'invalid_submission' | 'invalid_puzzle_state', message: string) {
    super(message)
    this.name = 'PuzzleError'
  }
}
