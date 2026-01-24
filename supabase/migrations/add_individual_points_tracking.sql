-- Individual Points Tracking Migration
-- Run this in Supabase SQL Editor

-- Add user_id column to progress table (nullable for backward compatibility)
-- References users table (from PIN system) or can be null for team-only progress
ALTER TABLE progress
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- Add individual_points_earned column to progress table
ALTER TABLE progress
ADD COLUMN IF NOT EXISTS individual_points_earned integer DEFAULT 0;

-- Create index for efficient queries by user_id and checkpoint_id
CREATE INDEX IF NOT EXISTS idx_progress_user_checkpoint 
ON progress (user_id, checkpoint_id);

-- Create index for efficient queries by team_id and user_id
CREATE INDEX IF NOT EXISTS idx_progress_team_user 
ON progress (team_id, user_id);

-- Update existing progress entries to have individual_points_earned equal to points_earned
-- This assumes existing progress was team-based, so we'll set individual points equal to team points
UPDATE progress p
SET individual_points_earned = COALESCE(p.points_earned, 0)
WHERE p.completed_at IS NOT NULL
AND (p.individual_points_earned IS NULL OR p.individual_points_earned = 0);
