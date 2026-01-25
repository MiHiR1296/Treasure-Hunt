-- Add hint_cost field to checkpoints table
-- This allows admins to set custom point cost per hint for each checkpoint

ALTER TABLE checkpoints
ADD COLUMN IF NOT EXISTS hint_cost integer DEFAULT 5;

-- Add comment for clarity
COMMENT ON COLUMN checkpoints.hint_cost IS 'Points deducted per hint used (default: 5)';
