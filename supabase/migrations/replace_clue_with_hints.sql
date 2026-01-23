-- Replace clue_text and hint_text with 3 separate hint columns
-- Run this in Supabase SQL Editor

-- Add 3 hint columns
ALTER TABLE checkpoints 
  ADD COLUMN IF NOT EXISTS hint_1 text,
  ADD COLUMN IF NOT EXISTS hint_2 text,
  ADD COLUMN IF NOT EXISTS hint_3 text;

-- Migrate existing hint_text to hint_1 (if exists)
UPDATE checkpoints 
SET hint_1 = hint_text 
WHERE hint_text IS NOT NULL AND hint_1 IS NULL;

-- Note: clue_text and hint_text are kept for backward compatibility
-- They will not be used in the new UI but won't break existing data
