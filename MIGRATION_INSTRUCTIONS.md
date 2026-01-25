# Database Migration Instructions

## Puzzle Hints System Migration

The `puzzle_hints` and `puzzle_hint_state` tables need to be created in your Supabase database.

### ⚠️ About the Warning

If Supabase shows a warning about "destructive operation", it's because the migration uses `DROP POLICY IF EXISTS` statements. **This is safe** because:
- ✅ Only RLS policies are dropped (not data)
- ✅ Policies are immediately recreated
- ✅ `IF EXISTS` prevents errors
- ✅ Migration is idempotent (safe to run multiple times)

**However**, if you want to avoid the warning, use the **safe version** below.

### Steps to Run Migration:

1. **Go to Supabase Dashboard**
   - Navigate to: https://supabase.com/dashboard/project/YOUR_PROJECT_ID
   - Replace `YOUR_PROJECT_ID` with your actual project ID

2. **Open SQL Editor**
   - Click on **SQL Editor** in the left sidebar
   - Click **New query**

3. **Choose Migration Version**

   **Option A: Safe Version (Recommended - No Warnings)** ⭐
   - Copy the entire contents of `supabase/migrations/add_puzzle_hints_system_safe.sql`
   - Paste it into the SQL Editor
   - Click **Run** (or press Ctrl/Cmd + Enter)
   - **No warnings will appear**

   **Option B: Original Version (May Show Warning)**
   - Copy the entire contents of `supabase/migrations/add_puzzle_hints_system.sql`
   - Paste it into the SQL Editor
   - Click **Run** (or press Ctrl/Cmd + Enter)
   - If warning appears, click **Confirm** - it's safe to proceed

4. **Verify Tables Were Created**
   - Run this query to verify:
   ```sql
   SELECT table_name 
   FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name IN ('puzzle_hints', 'puzzle_hint_state');
   ```
   - You should see both tables listed

5. **Check RLS Policies**
   - The migration includes RLS policies, but verify they exist:
   ```sql
   SELECT * FROM pg_policies 
   WHERE tablename IN ('puzzle_hints', 'puzzle_hint_state');
   ```

### Alternative: Using Supabase CLI

If you have Supabase CLI set up:

```bash
supabase db push
```

This will apply all pending migrations.

### Troubleshooting

If you get errors:
- **"relation already exists"**: The tables already exist, which is fine
- **"permission denied"**: Make sure you're using the correct database user
- **"syntax error"**: Check that you copied the entire migration file correctly

After running the migration, refresh your admin panel and try adding a puzzle hint image again.

## Storage Bucket Setup (Required for Image Uploads)

**IMPORTANT:** You must create the `puzzle-images` storage bucket before uploading puzzle hint images.

See `STORAGE_BUCKET_SETUP.md` for detailed instructions, or follow these quick steps:

1. Go to Supabase Dashboard → **Storage**
2. Click **New bucket**
3. Name: `puzzle-images` (exact name, case-sensitive)
4. ✅ Check **Public bucket** (uncheck "Private bucket")
5. Click **Create bucket**
6. Add policies for SELECT, INSERT, UPDATE, DELETE (see `STORAGE_BUCKET_SETUP.md` for details)

**Quick SQL Setup** (run in SQL Editor):
```sql
-- Create bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('puzzle-images', 'puzzle-images', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access
DROP POLICY IF EXISTS "Public read access" ON storage.objects;
CREATE POLICY "Public read access"
ON storage.objects FOR SELECT
USING (bucket_id = 'puzzle-images');

-- Anyone can upload
DROP POLICY IF EXISTS "Anyone can upload" ON storage.objects;
CREATE POLICY "Anyone can upload"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'puzzle-images');

-- Anyone can update
DROP POLICY IF EXISTS "Anyone can update" ON storage.objects;
CREATE POLICY "Anyone can update"
ON storage.objects FOR UPDATE
USING (bucket_id = 'puzzle-images')
WITH CHECK (bucket_id = 'puzzle-images');

-- Anyone can delete
DROP POLICY IF EXISTS "Anyone can delete" ON storage.objects;
CREATE POLICY "Anyone can delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'puzzle-images');
```

**Note:** The `DROP POLICY IF EXISTS` statements may show a warning, but it's safe - they only affect policies, not data.

## About the Old Puzzle Chain System

**Do NOT remove the old puzzle chain system!** Both systems coexist:

- **Old System** (`puzzle_steps`, `puzzle_progress`): Used for `use_puzzle_chain` checkpoints (puzzles before unlock)
- **New System** (`puzzle_hints`, `puzzle_hint_state`): Used for individual puzzle hints that replace text hints (slots 1-3)

Both systems serve different purposes and are both actively used in the application.
