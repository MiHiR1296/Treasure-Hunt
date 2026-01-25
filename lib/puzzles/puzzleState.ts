// Puzzle state persistence utilities
import { supabase } from '@/lib/supabase/client';

export interface PuzzleState {
  [key: string]: any;
  completed?: boolean;
}

/**
 * Save puzzle state to database
 */
export async function savePuzzleState(
  teamId: string,
  puzzleHintId: string,
  checkpointId: string,
  state: PuzzleState
): Promise<void> {
  try {
    await supabase
      .from('puzzle_hint_state')
      .upsert({
        team_id: teamId,
        puzzle_hint_id: puzzleHintId,
        checkpoint_id: checkpointId,
        puzzle_state: state,
        is_completed: state.completed || false,
        last_updated: new Date().toISOString(),
      }, {
        onConflict: 'team_id,puzzle_hint_id',
      });
  } catch (error) {
    console.error('Error saving puzzle state:', error);
    throw error;
  }
}

/**
 * Load puzzle state from database
 */
export async function loadPuzzleState(
  teamId: string,
  puzzleHintId: string
): Promise<PuzzleState | null> {
  try {
    const { data, error } = await supabase
      .from('puzzle_hint_state')
      .select('puzzle_state, is_completed')
      .eq('team_id', teamId)
      .eq('puzzle_hint_id', puzzleHintId)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      return {
        ...data.puzzle_state,
        completed: data.is_completed,
      };
    }

    return null;
  } catch (error) {
    console.error('Error loading puzzle state:', error);
    return null;
  }
}

/**
 * Get state structure for each puzzle type
 */
export function getPuzzleStateFormat(puzzleType: string): PuzzleState {
  switch (puzzleType) {
    case 'jigsaw':
      return {
        piecePositions: [],
        completed: false,
      };
    case 'sudoku':
      return {
        grid: [],
        completed: false,
      };
    case 'crossword':
      return {
        answers: {},
        completed: false,
      };
    case 'word_search':
      return {
        foundWords: [],
        completed: false,
      };
    case 'circular_rotate':
      return {
        rotations: [],
        completed: false,
      };
    default:
      return {
        completed: false,
      };
  }
}

/**
 * Debounced save function
 */
export function createDebouncedSave(
  saveFn: () => Promise<void>,
  delay: number = 1500
): () => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      saveFn().catch(console.error);
      timeoutId = null;
    }, delay);
  };
}
