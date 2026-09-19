-- Puzzle Chain System Migration
-- Run this in Supabase SQL Editor

-- 1. Add use_puzzle_chain flag to checkpoints
ALTER TABLE checkpoints
ADD COLUMN IF NOT EXISTS use_puzzle_chain boolean DEFAULT false;

-- 2. Create puzzle_steps table
CREATE TABLE IF NOT EXISTS puzzle_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_id uuid REFERENCES checkpoints(id) ON DELETE CASCADE,
  step_order int NOT NULL,  -- Order in the chain (1, 2, 3, ...)
  
  -- Puzzle configuration
  puzzle_type text NOT NULL CHECK (puzzle_type IN (
    'text',           -- Text clue/riddle
    'jigsaw',         -- Jigsaw puzzle
    'sudoku',         -- Sudoku puzzle
    'crossword',      -- Crossword (image-based)
    'word_search',    -- Find the word game
    'circular_rotate' -- Circular rotation puzzle
  )),
  
  puzzle_config jsonb,  -- Puzzle-specific configuration
  puzzle_image_url text,  -- Image URL for image-based puzzles
  
  -- Answer configuration
  answer_type text NOT NULL CHECK (answer_type IN ('text', 'qr_code')),
  answer_value text,  -- Expected answer (text) or QR code value
  
  -- Display
  title text,  -- Optional step title
  description text,  -- Optional step description
  
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_puzzle_steps_checkpoint_order 
ON puzzle_steps (checkpoint_id, step_order);

-- 3. Create puzzle_progress table
CREATE TABLE IF NOT EXISTS puzzle_progress (
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  checkpoint_id uuid REFERENCES checkpoints(id) ON DELETE CASCADE,
  step_id uuid REFERENCES puzzle_steps(id) ON DELETE CASCADE,
  completed_at timestamptz DEFAULT now(),
  PRIMARY KEY (team_id, checkpoint_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_puzzle_progress_team_checkpoint 
ON puzzle_progress (team_id, checkpoint_id);

CREATE INDEX IF NOT EXISTS idx_puzzle_progress_step 
ON puzzle_progress (step_id);

-- 4. Row Level Security Policies

-- Puzzle steps: anyone can read
ALTER TABLE puzzle_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Puzzle steps are viewable by everyone" ON puzzle_steps;
CREATE POLICY "Puzzle steps are viewable by everyone" 
ON puzzle_steps FOR SELECT USING (true);

-- Allow admin to insert/update/delete puzzle steps
DROP POLICY IF EXISTS "Anyone can create puzzle steps" ON puzzle_steps;
CREATE POLICY "Anyone can create puzzle steps" 
ON puzzle_steps FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update puzzle steps" ON puzzle_steps;
CREATE POLICY "Anyone can update puzzle steps" 
ON puzzle_steps FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can delete puzzle steps" ON puzzle_steps;
CREATE POLICY "Anyone can delete puzzle steps" 
ON puzzle_steps FOR DELETE USING (true);

-- Puzzle progress: teams can see their own progress
ALTER TABLE puzzle_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teams can view their own puzzle progress" ON puzzle_progress;
CREATE POLICY "Teams can view their own puzzle progress" 
ON puzzle_progress FOR SELECT USING (true);

DROP POLICY IF EXISTS "Teams can insert their own puzzle progress" ON puzzle_progress;
CREATE POLICY "Teams can insert their own puzzle progress" 
ON puzzle_progress FOR INSERT WITH CHECK (true);
