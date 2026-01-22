# SQL Migration Safety Guide

## About the Supabase Warning

When you run the migration SQL, Supabase may show a warning:
> "Query has destructive operation - Make sure you are not accidentally removing something important"

### Why This Warning Appears

The warning appears because the SQL contains `DROP POLICY IF EXISTS` statements. However, **this is safe** because:

1. ✅ `IF EXISTS` prevents errors if policies don't exist
2. ✅ Policies are immediately recreated after dropping
3. ✅ The migration is idempotent (safe to run multiple times)
4. ✅ No data is deleted - only policies are replaced

### Two Migration Options

#### Option 1: Original Migration (with DROP statements)
**File:** `supabase/migrations/add_puzzle_chain_system.sql`
- Uses `DROP POLICY IF EXISTS` then recreates
- Supabase will show warning
- **Safe to run** - the warning is just a precaution

#### Option 2: Safe Migration (no DROP statements) ⭐ RECOMMENDED
**File:** `supabase/migrations/add_puzzle_chain_system_safe.sql`
- Uses `DO $$` blocks to check if policies exist before creating
- **No warnings** from Supabase
- Same functionality, just different approach

### Recommendation

**Use the safe version** (`add_puzzle_chain_system_safe.sql`) to avoid warnings.

## Git Branch Information

### Current Branch
- **Branch:** `feature/puzzle-chain-system`
- **Commit:** `617e069`
- **Status:** All changes committed locally

### To Push to GitHub
```bash
git push -u origin feature/puzzle-chain-system
```

### To Revert if Needed

#### Option 1: Switch back to main (keeps feature branch)
```bash
git checkout main
```

#### Option 2: Delete the feature branch (if you want to start over)
```bash
git checkout main
git branch -D feature/puzzle-chain-system
```

#### Option 3: Revert the commit (keeps branch but undoes changes)
```bash
git revert 617e069
```

#### Option 4: Reset to before the commit (destructive - use carefully)
```bash
git reset --hard HEAD~1
```

### To Merge to Main (after testing)
```bash
git checkout main
git merge feature/puzzle-chain-system
git push origin main
```

## Database Rollback (if needed)

If you need to rollback the database changes:

```sql
-- Remove puzzle chain system
DROP TABLE IF EXISTS puzzle_progress;
DROP TABLE IF EXISTS puzzle_steps;
ALTER TABLE checkpoints DROP COLUMN IF EXISTS use_puzzle_chain;
```

**Note:** This will delete all puzzle chain data. Only do this if you're sure you want to remove the feature.

## Safety Checklist

Before running the migration:
- [ ] You're on the `feature/puzzle-chain-system` branch
- [ ] All changes are committed
- [ ] You've backed up your database (Supabase does this automatically)
- [ ] You're using the safe SQL version (recommended)

After running the migration:
- [ ] Verify tables were created: `puzzle_steps`, `puzzle_progress`
- [ ] Verify column was added: `checkpoints.use_puzzle_chain`
- [ ] Test creating a checkpoint with puzzle chain
- [ ] Test the player experience

## Need Help?

If something goes wrong:
1. Check the Supabase logs in the dashboard
2. Verify RLS policies are active
3. Check that storage bucket exists
4. Review the error messages in browser console
5. Revert using git commands above if needed
