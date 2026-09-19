-- Quick fix: Just add the missing checkpoint INSERT policy
-- Run this in Supabase SQL Editor

-- Only create if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'checkpoints' 
    AND policyname = 'Anyone can create checkpoints'
  ) THEN
    CREATE POLICY "Anyone can create checkpoints" 
    ON checkpoints FOR INSERT 
    WITH CHECK (true);
  END IF;
END $$;
