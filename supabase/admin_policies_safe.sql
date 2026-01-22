-- Safe version: Drops existing policies first, then creates them
-- Run this in Supabase SQL Editor

-- Drop existing policies if they exist (to avoid errors)
DROP POLICY IF EXISTS "Anyone can update hunts" ON hunts;
DROP POLICY IF EXISTS "Anyone can delete hunts" ON hunts;
DROP POLICY IF EXISTS "Anyone can create checkpoints" ON checkpoints;
DROP POLICY IF EXISTS "Anyone can update checkpoints" ON checkpoints;
DROP POLICY IF EXISTS "Anyone can delete checkpoints" ON checkpoints;
DROP POLICY IF EXISTS "Anyone can update teams" ON teams;
DROP POLICY IF EXISTS "Anyone can delete teams" ON teams;
DROP POLICY IF EXISTS "Anyone can view all progress" ON progress;
DROP POLICY IF EXISTS "Anyone can view all hint requests" ON hint_requests;

-- Now create all policies
-- Allow updates and deletes on hunts (for admin)
CREATE POLICY "Anyone can update hunts" 
ON hunts FOR UPDATE 
USING (true) 
WITH CHECK (true);

CREATE POLICY "Anyone can delete hunts" 
ON hunts FOR DELETE 
USING (true);

-- Allow inserts, updates and deletes on checkpoints (for admin)
CREATE POLICY "Anyone can create checkpoints" 
ON checkpoints FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update checkpoints" 
ON checkpoints FOR UPDATE 
USING (true) 
WITH CHECK (true);

CREATE POLICY "Anyone can delete checkpoints" 
ON checkpoints FOR DELETE 
USING (true);

-- Allow updates and deletes on teams (for admin)
CREATE POLICY "Anyone can update teams" 
ON teams FOR UPDATE 
USING (true) 
WITH CHECK (true);

CREATE POLICY "Anyone can delete teams" 
ON teams FOR DELETE 
USING (true);

-- Allow admin to view all progress (for dashboard)
CREATE POLICY "Anyone can view all progress" 
ON progress FOR SELECT 
USING (true);

-- Allow admin to view all hint requests (for dashboard)
CREATE POLICY "Anyone can view all hint requests" 
ON hint_requests FOR SELECT 
USING (true);
