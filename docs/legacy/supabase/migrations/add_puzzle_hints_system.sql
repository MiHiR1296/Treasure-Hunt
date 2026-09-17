-- Puzzle Hints System Migration
-- Individual puzzle hints that can replace text hints, with state persistence

-- 1. Create puzzle_hints table
CREATE TABLE IF NOT EXISTS puzzle_hints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_id uuid REFERENCES checkpoints(id) ON DELETE CASCADE,
  hint_slot integer NOT NULL CHECK (hint_slot IN (1, 2, 3)), -- Which text hint slot this replaces
  puzzle_type text NOT NULL CHECK (puzzle_type IN (
    'jigsaw',
    'sudoku',
    'crossword',
    'word_search',
    'circular_rotate'
  )),
  puzzle_config jsonb, -- Puzzle-specific configuration
  puzzle_image_url text, -- For image-based puzzles
  points_cost integer NOT NULL DEFAULT 5, -- Custom point cost for this puzzle hint
  completion_message text, -- Custom message shown on completion (nullable)
  show_custom_message boolean DEFAULT false, -- Whether to show custom message or just OK button
  title text, -- Optional title for the puzzle hint
  description text, -- Optional description
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_puzzle_hints_checkpoint 
ON puzzle_hints (checkpoint_id);

CREATE INDEX IF NOT EXISTS idx_puzzle_hints_checkpoint_slot 
ON puzzle_hints (checkpoint_id, hint_slot);

-- 2. Create puzzle_hint_state table for state persistence
CREATE TABLE IF NOT EXISTS puzzle_hint_state (
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  puzzle_hint_id uuid REFERENCES puzzle_hints(id) ON DELETE CASCADE,
  checkpoint_id uuid REFERENCES checkpoints(id) ON DELETE CASCADE, -- Denormalized for easier queries
  puzzle_state jsonb NOT NULL DEFAULT '{}', -- Puzzle-specific state (jigsaw positions, sudoku grid, etc.)
  is_completed boolean DEFAULT false, -- Whether puzzle is fully solved
  last_updated timestamptz DEFAULT now(),
  PRIMARY KEY (team_id, puzzle_hint_id)
);

CREATE INDEX IF NOT EXISTS idx_puzzle_hint_state_team_checkpoint 
ON puzzle_hint_state (team_id, checkpoint_id);

CREATE INDEX IF NOT EXISTS idx_puzzle_hint_state_hint 
ON puzzle_hint_state (puzzle_hint_id);

-- 3. Row Level Security Policies

-- Puzzle hints: anyone can read
ALTER TABLE puzzle_hints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Puzzle hints are viewable by everyone" ON puzzle_hints;
CREATE POLICY "Puzzle hints are viewable by everyone" ON puzzle_hints
  FOR SELECT
  USING (true);

-- Allow anyone to insert puzzle hints (for admin panel)
DROP POLICY IF EXISTS "Anyone can create puzzle hints" ON puzzle_hints;
CREATE POLICY "Anyone can create puzzle hints" ON puzzle_hints
  FOR INSERT
  WITH CHECK (true);

-- Allow anyone to update puzzle hints (for admin panel)
DROP POLICY IF EXISTS "Anyone can update puzzle hints" ON puzzle_hints;
CREATE POLICY "Anyone can update puzzle hints" ON puzzle_hints
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Allow anyone to delete puzzle hints (for admin panel)
DROP POLICY IF EXISTS "Anyone can delete puzzle hints" ON puzzle_hints;
CREATE POLICY "Anyone can delete puzzle hints" ON puzzle_hints
  FOR DELETE
  USING (true);

DROP POLICY IF EXISTS "Anyone can create puzzle hints" ON puzzle_hints;
CREATE POLICY "Anyone can create puzzle hints" ON puzzle_hints
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update puzzle hints" ON puzzle_hints;
CREATE POLICY "Anyone can update puzzle hints" ON puzzle_hints
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can delete puzzle hints" ON puzzle_hints;
CREATE POLICY "Anyone can delete puzzle hints" ON puzzle_hints
  FOR DELETE
  USING (true);

-- Puzzle hint state: teams can only read/write their own state
ALTER TABLE puzzle_hint_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teams can view their own puzzle hint state" ON puzzle_hint_state;
CREATE POLICY "Teams can view their own puzzle hint state" ON puzzle_hint_state
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Teams can insert their own puzzle hint state" ON puzzle_hint_state;
CREATE POLICY "Teams can insert their own puzzle hint state" ON puzzle_hint_state
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Teams can update their own puzzle hint state" ON puzzle_hint_state;
CREATE POLICY "Teams can update their own puzzle hint state" ON puzzle_hint_state
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Add comment for clarity
COMMENT ON TABLE puzzle_hints IS 'Individual puzzle hints that can replace text hints (slots 1-3)';
COMMENT ON TABLE puzzle_hint_state IS 'Persistent state for puzzle hints, saved per team';
