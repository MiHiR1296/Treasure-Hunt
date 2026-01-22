# Fix RLS Issues - Quick Guide

## Problem 1: Cannot Create Checkpoints

**Error**: "new row violates row-level security policy for table 'checkpoints'"

### Solution:

Run this SQL in Supabase SQL Editor:

```sql
-- Allow inserts on checkpoints (for admin)
CREATE POLICY "Anyone can create checkpoints" 
ON checkpoints FOR INSERT 
WITH CHECK (true);
```

Or run the updated `supabase/admin_policies.sql` file which now includes this policy.

## Problem 2: Progress Query Failing

**Error**: 400 error on progress queries

### Solution:

The progress RLS policy already allows viewing all progress. If you still get errors, verify the policy exists:

```sql
-- Check if policy exists
SELECT * FROM pg_policies WHERE tablename = 'progress';

-- If missing, create it:
CREATE POLICY "Anyone can view all progress" 
ON progress FOR SELECT 
USING (true);
```

## Problem 3: Leaderboard Shows "No Teams Yet"

### What Changed:

The leaderboard now shows:
- ✅ All teams that have **started** the hunt (have at least one progress entry)
- ✅ Team names are visible to everyone
- ✅ Shows progress (X / Y checkpoints)
- ✅ Updates in real-time

**Note**: Teams only appear on the leaderboard after they unlock their first checkpoint. This is by design - it shows active participants.

## Quick Fix SQL

Run this complete SQL to fix all RLS issues:

```sql
-- Fix 1: Allow checkpoint creation
CREATE POLICY "Anyone can create checkpoints" 
ON checkpoints FOR INSERT 
WITH CHECK (true);

-- Fix 2: Allow viewing all progress (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'progress' 
    AND policyname = 'Anyone can view all progress'
  ) THEN
    CREATE POLICY "Anyone can view all progress" 
    ON progress FOR SELECT 
    USING (true);
  END IF;
END $$;
```

## After Running SQL

1. Try creating a checkpoint again - should work now
2. Check leaderboard - should show teams that have started
3. All team names are visible to everyone

## Testing

1. Create a checkpoint in admin panel
2. Join as a team and unlock a checkpoint
3. Check leaderboard - your team should appear
4. Other teams should see your team name too
