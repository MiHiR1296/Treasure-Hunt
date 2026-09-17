-- Points System Migration
-- Run this in Supabase SQL Editor

-- 1. Add points column to checkpoints
ALTER TABLE checkpoints
ADD COLUMN IF NOT EXISTS points integer DEFAULT 20;

-- Update existing checkpoints to have 20 points
UPDATE checkpoints SET points = 20 WHERE points IS NULL;

-- 2. Add points tracking to progress
ALTER TABLE progress
ADD COLUMN IF NOT EXISTS points_earned integer DEFAULT 0;

-- hints_used already exists, but ensure it defaults to 0
ALTER TABLE progress
ALTER COLUMN hints_used SET DEFAULT 0;

-- Calculate points for existing completed checkpoints
-- (This is a one-time migration for existing data)
UPDATE progress p
SET points_earned = COALESCE(
  (SELECT c.points FROM checkpoints c WHERE c.id = p.checkpoint_id),
  20
) - COALESCE(p.hints_used, 0) * 5
WHERE p.completed_at IS NOT NULL
AND p.points_earned = 0;
