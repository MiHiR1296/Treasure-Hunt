-- Add points column to checkpoints table
-- Run this in Supabase SQL Editor

ALTER TABLE checkpoints 
ADD COLUMN IF NOT EXISTS points integer DEFAULT 20;

-- Update existing checkpoints to have 20 points if null
UPDATE checkpoints 
SET points = 20 
WHERE points IS NULL;
