# Fix Admin Panel Error

## The Problem

When creating a hunt, you're getting an empty error `{}`. This usually means:

1. **Wrong API Key Format** - The key `sb_publishable_...` is not a standard Supabase JWT key
2. **Missing Database Tables** - The schema wasn't run in Supabase
3. **RLS Policies** - Row Level Security might be blocking inserts

## Quick Fixes

### Fix 1: Get the Correct API Key

The key you provided (`sb_publishable_...`) is not a standard Supabase key. Get the correct one:

1. Go to: https://supabase.com/dashboard/project/wjvezuqrygbzbvnoyxuk
2. Click **Settings** → **API**
3. Find **"anon public"** key
4. It should be a **long JWT token starting with `eyJ...`**
5. Copy it
6. Update your `.env.local` file:
   ```
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... (your actual key)
   ```
7. **Restart your dev server** (`npm run dev`)

### Fix 2: Verify Database Schema

Make sure you ran the SQL schema:

1. Go to: https://supabase.com/dashboard/project/wjvezuqrygbzbvnoyxuk
2. Click **SQL Editor** → **New query**
3. Check if tables exist:
   ```sql
   SELECT table_name 
   FROM information_schema.tables 
   WHERE table_schema = 'public';
   ```
4. You should see: `teams`, `hunts`, `checkpoints`, `progress`, `hint_requests`
5. If not, run `supabase/schema.sql` again

### Fix 3: Check RLS Policies

The admin panel needs to insert into `hunts` table. Check RLS:

1. Go to Supabase Dashboard → **Table Editor**
2. Click on `hunts` table
3. Check **"RLS enabled"** is ON
4. Go to **SQL Editor** and verify policies exist:
   ```sql
   SELECT * FROM pg_policies WHERE tablename = 'hunts';
   ```

If no policies, run this:
```sql
-- Allow anyone to read hunts
CREATE POLICY "Hunts are viewable by everyone" 
ON hunts FOR SELECT 
USING (true);

-- Allow anyone to insert hunts (for admin panel)
CREATE POLICY "Anyone can create hunts" 
ON hunts FOR INSERT 
WITH CHECK (true);
```

### Fix 4: Test Connection

Run the test script to see detailed errors:

```bash
npx tsx scripts/test-connection.ts
```

This will show you exactly what's wrong.

## Check Browser Console

1. Open browser DevTools (F12)
2. Go to **Console** tab
3. Try creating a hunt again
4. Look for detailed error messages
5. The improved error handling will now show full error details

## Common Error Messages

**"Invalid API key" or "JWT expired":**
→ Get correct key from Supabase Dashboard

**"relation 'hunts' does not exist":**
→ Run the SQL schema in Supabase SQL Editor

**"new row violates row-level security policy":**
→ Check RLS policies (see Fix 3 above)

**"permission denied":**
→ Check RLS policies allow INSERT

## After Fixing

1. Restart dev server: `npm run dev`
2. Try creating hunt again
3. Check browser console for detailed errors
4. If still failing, share the console error message
