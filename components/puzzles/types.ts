// Types for puzzle system

export type PuzzleType = 'text' | 'jigsaw' | 'sudoku' | 'crossword' | 'word_search' | 'circular_rotate';
export type AnswerType = 'text' | 'qr_code';

export interface PuzzleStep {
  id: string;
  checkpoint_id: string;
  step_order: number;
  puzzle_type: PuzzleType;
  puzzle_config: Record<string, any> | null;
  puzzle_image_url: string | null;
  answer_type: AnswerType;
  answer_value: string | null;
  title: string | null;
  description: string | null;
  created_at: string;
}

export interface PuzzleProgress {
  team_id: string;
  checkpoint_id: string;
  step_id: string;
  completed_at: string;
}

// Puzzle Hint types (for individual puzzle hints that replace text hints)
export interface PuzzleHint {
  id: string;
  checkpoint_id: string;
  hint_slot: number; // 1, 2, or 3
  puzzle_type: PuzzleType;
  puzzle_config: Record<string, any> | null;
  puzzle_image_url: string | null;
  points_cost: number;
  completion_message: string | null;
  show_custom_message: boolean;
  title: string | null;
  description: string | null;
  created_at: string;
}

export interface PuzzleHintState {
  team_id: string;
  puzzle_hint_id: string;
  checkpoint_id: string;
  puzzle_state: Record<string, any>;
  is_completed: boolean;
  last_updated: string;
}
