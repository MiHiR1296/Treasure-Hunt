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
