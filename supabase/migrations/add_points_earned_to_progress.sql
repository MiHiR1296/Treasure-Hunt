-- Add points_earned column to progress table
-- Run this in Supabase SQL Editor

ALTER TABLE progress
ADD COLUMN IF NOT EXISTS points_earned integer DEFAULT 0;

-- Update existing progress entries to have points_earned
-- For completed checkpoints, calculate points based on checkpoint points minus hints used
UPDATE progress p
SET points_earned = COALESCE(
  (SELECT c.points FROM checkpoints c WHERE c.id = p.checkpoint_id),
  20
) - COALESCE(p.hints_used, 0) * 5
WHERE p.completed_at IS NOT NULL
AND (p.points_earned IS NULL OR p.points_earned = 0);

-- For unlocked but not completed checkpoints, set to full points (will be deducted when hints are used)
UPDATE progress p
SET points_earned = COALESCE(
  (SELECT c.points FROM checkpoints c WHERE c.id = p.checkpoint_id),
  20
)
WHERE p.completed_at IS NULL
AND (p.points_earned IS NULL OR p.points_earned = 0);
