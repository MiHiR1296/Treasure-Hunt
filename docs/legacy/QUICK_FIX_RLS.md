# Quick Fix for RLS Policies

## The Error

You're getting: "policy already exists"

This means some policies are already created. Use the **safe version** that drops and recreates them.

## ✅ Solution: Run This SQL

Copy and run this in Supabase SQL Editor:

```sql
-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can update hunts" ON hunts;
DROP POLICY IF EXISTS "Anyone can delete hunts" ON hunts;
DROP POLICY IF EXISTS "Anyone can create checkpoints" ON checkpoints;
DROP POLICY IF EXISTS "Anyone can update checkpoints" ON checkpoints;
DROP POLICY IF EXISTS "Anyone can delete checkpoints" ON checkpoints;
DROP POLICY IF EXISTS "Anyone can update teams" ON teams;
DROP POLICY IF EXISTS "Anyone can delete teams" ON teams;
DROP POLICY IF EXISTS "Anyone can view all progress" ON progress;
DROP POLICY IF EXISTS "Anyone can view all hint requests" ON hint_requests;

-- Create all policies
CREATE POLICY "Anyone can update hunts" ON hunts FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete hunts" ON hunts FOR DELETE USING (true);
CREATE POLICY "Anyone can create checkpoints" ON checkpoints FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update checkpoints" ON checkpoints FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete checkpoints" ON checkpoints FOR DELETE USING (true);
CREATE POLICY "Anyone can update teams" ON teams FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete teams" ON teams FOR DELETE USING (true);
CREATE POLICY "Anyone can view all progress" ON progress FOR SELECT USING (true);
CREATE POLICY "Anyone can view all hint requests" ON hint_requests FOR SELECT USING (true);
```

**Or use the file**: `supabase/admin_policies_safe.sql`

## After Running

1. ✅ Can create checkpoints
2. ✅ Can view all progress
3. ✅ Leaderboard shows all teams
4. ✅ All admin features work

## Test

1. Try creating a checkpoint in admin panel
2. Should work without errors!
