# Easy Fix - Just Add Missing Policy

## The Problem

You're getting "policy already exists" because some policies are already there.

## ✅ Simple Solution

Just run this ONE line to add the missing checkpoint INSERT policy:

```sql
CREATE POLICY "Anyone can create checkpoints" 
ON checkpoints FOR INSERT 
WITH CHECK (true);
```

If you get "already exists" error, that's fine - it means it's already there!

## Or Use the Safe Version

If you want to be sure, use the file: `supabase/fix_checkpoint_insert.sql`

It checks if the policy exists before creating it.

## After Running

Try creating a checkpoint in admin panel - should work now! ✅

## If You Still Get Errors

Check which policies exist:

```sql
SELECT tablename, policyname 
FROM pg_policies 
WHERE tablename IN ('checkpoints', 'progress', 'hunts', 'teams')
ORDER BY tablename, policyname;
```

This shows you what's already there.
