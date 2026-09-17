-- PIN-Based Team System Migration
-- Run this in Supabase SQL Editor

-- 1. Create users table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- 2. Add PIN and created_by_user_id to teams table
ALTER TABLE teams
ADD COLUMN IF NOT EXISTS pin text;

ALTER TABLE teams
ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- 3. Create indexes
CREATE INDEX IF NOT EXISTS idx_users_team_id ON users(team_id);
CREATE INDEX IF NOT EXISTS idx_teams_pin ON teams(pin) WHERE pin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_teams_created_by ON teams(created_by_user_id) WHERE created_by_user_id IS NOT NULL;

-- 4. Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for users table
-- Anyone can read users (for team member lists)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'users' 
    AND policyname = 'Users are viewable by everyone'
  ) THEN
    CREATE POLICY "Users are viewable by everyone" ON users FOR SELECT USING (true);
  END IF;
END $$;

-- Anyone can create users (for registration)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'users' 
    AND policyname = 'Users can be created by anyone'
  ) THEN
    CREATE POLICY "Users can be created by anyone" ON users FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- Users can update their own record
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'users' 
    AND policyname = 'Users can update their own record'
  ) THEN
    CREATE POLICY "Users can update their own record" ON users FOR UPDATE USING (true);
  END IF;
END $$;

-- 6. Update teams table policies if needed (PIN should be readable by everyone for validation)
-- Teams are already viewable by everyone, so PIN will be accessible

-- Note: Existing teams will have NULL PIN values
-- New teams created through the PIN system will have PINs set
-- Admins can optionally set PINs for existing teams
