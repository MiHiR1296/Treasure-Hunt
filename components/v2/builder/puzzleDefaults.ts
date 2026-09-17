import type { PuzzleDefinition } from '@/lib/engine/puzzles/types';

export function defaultPuzzle(type: PuzzleDefinition['type']): PuzzleDefinition {
  switch (type) {
    case 'text': return { type, prompt: '', answers: [''] };
    case 'multiple_choice': return { type, prompt: '', options: [{ id: 'option-1', label: '' }, { id: 'option-2', label: '' }], correctOptionId: 'option-1' };
    case 'matching': return { type, left: [{ id: 'left-1', label: '' }, { id: 'left-2', label: '' }], right: [{ id: 'right-1', label: '' }, { id: 'right-2', label: '' }], solution: [{ leftId: 'left-1', rightId: 'right-1' }, { leftId: 'left-2', rightId: 'right-2' }] };
    case 'sequence': return { type, items: [{ id: 'item-1', label: '' }, { id: 'item-2', label: '' }], solution: ['item-1', 'item-2'] };
    case 'sudoku': return { type, size: 4, givens: [[1, 0, 0, 4], [0, 4, 1, 0], [0, 1, 4, 0], [4, 0, 0, 1]] };
    case 'word_search': return { type, grid: ['TRAIL', 'ORBIT', 'WATER', 'EXTRA', 'RIVER'].map(row => row.split('')), words: ['TRAIL', 'WATER', 'RIVER'] };
    case 'crossword': return { type, rows: 5, columns: 5, entries: [{ id: 'word-1', clue: '', answer: '', row: 0, column: 0, direction: 'across' }] };
    case 'jigsaw': return { type, rows: 2, columns: 2, pieces: [1, 2, 3, 4].map(index => ({ id: `piece-${index}`, imageUrl: '', alt: `Tile ${index}` })), solution: ['piece-1', 'piece-2', 'piece-3', 'piece-4'] };
    case 'rotation': return { type, columns: 2, tiles: [1, 2, 3, 4].map(index => ({ id: `tile-${index}`, imageUrl: '', alt: `Tile ${index}`, correctRotation: 0 })) };
  }
}
