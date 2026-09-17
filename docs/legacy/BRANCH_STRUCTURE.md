# Branch Structure & Version Management

## Current Branch Setup

### 🌿 Branches

1. **`main`** (Production)
   - ✅ **Current version with puzzle chain system**
   - 🚀 **This is what gets deployed to Vercel**
   - Contains all latest features including puzzles
   - **Version 2.0**

2. **`backup/v1-stable`** (Stable Backup)
   - ✅ **Stable version WITHOUT puzzle features**
   - 📦 **Safe backup you can revert to**
   - Contains the working version before puzzles
   - **Version 1.0**

3. **`feature/puzzle-chain-system`** (Feature Branch)
   - ✅ **Development branch for puzzle features**
   - Can be deleted or kept for reference
   - Already merged into main

### 🏷️ Git Tags

- **`v1.0.0`** - Stable version before puzzle chain system
  - Tagged on `backup/v1-stable` branch
  - Easy reference point for stable version

## Branch Structure Diagram

```
main (v2.0 - with puzzles) ← Deployed to Vercel
  ↑
  └── Merged from feature/puzzle-chain-system
  
backup/v1-stable (v1.0 - stable) ← Safe backup
  ↑
  └── Tagged as v1.0.0
  
feature/puzzle-chain-system (development)
  ↑
  └── Merged into main
```

## How to Use

### View Current Branch
```bash
git branch
# * main (you're here)
```

### Switch to Stable Backup
```bash
git checkout backup/v1-stable
# Now you're on the stable version without puzzles
```

### Switch Back to Main (with puzzles)
```bash
git checkout main
# Back to version with puzzle features
```

### View Tagged Version
```bash
git checkout v1.0.0
# Checkout the exact stable version
# (creates detached HEAD - use for reference only)
```

## Deployment Status

### What Gets Deployed

**Vercel Production:**
- Deploys from `main` branch
- Currently has puzzle chain system (v2.0)
- **When you push main, Vercel auto-deploys**

### To Deploy Current Main

```bash
# Make sure you're on main
git checkout main

# Push to GitHub (triggers Vercel deployment)
git push origin main

# Also push the backup branch and tag
git push origin backup/v1-stable
git push origin v1.0.0
```

## Reverting to Stable Version

### If You Need to Revert Production

**Option 1: Revert Main to Stable (Recommended)**
```bash
# Switch to main
git checkout main

# Reset main to stable version
git reset --hard backup/v1-stable

# Force push (⚠️ This will remove puzzle features from production)
git push origin main --force
```

**Option 2: Create New Branch from Stable**
```bash
# Create a new branch from stable
git checkout backup/v1-stable
git checkout -b hotfix/revert-to-stable

# Merge into main
git checkout main
git merge hotfix/revert-to-stable
git push origin main
```

**Option 3: Use Git Tag**
```bash
# Reset to tagged version
git checkout main
git reset --hard v1.0.0
git push origin main --force
```

## Best Practices

### Before Making Changes

1. **Always work on feature branches:**
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/your-new-feature
   ```

2. **Test before merging:**
   - Test locally
   - Create preview deployment
   - Then merge to main

### Keeping Branches in Sync

```bash
# Update main from remote
git checkout main
git pull origin main

# Update backup branch (if needed)
git checkout backup/v1-stable
git pull origin backup/v1-stable
```

## Quick Reference

| Branch | Purpose | Status | Deployed |
|--------|---------|--------|----------|
| `main` | Production | ✅ Active | ✅ Yes (Vercel) |
| `backup/v1-stable` | Stable backup | ✅ Active | ❌ No |
| `feature/puzzle-chain-system` | Feature dev | ✅ Merged | ❌ No |

## Version History

- **v2.0** (main) - With puzzle chain system
- **v1.0.0** (backup/v1-stable) - Stable version before puzzles

## Commands Cheat Sheet

```bash
# See all branches
git branch -a

# See all tags
git tag -l

# Switch branches
git checkout main
git checkout backup/v1-stable

# Push all branches and tags
git push origin main
git push origin backup/v1-stable
git push origin v1.0.0
git push --tags

# View commit history
git log --oneline --graph --all
```

## Safety Notes

✅ **Safe Operations:**
- Switching between branches
- Creating new feature branches
- Viewing backup branch
- Pushing to GitHub

⚠️ **Be Careful:**
- Force pushing to main (removes commits)
- Resetting main branch
- Deleting backup branch

🔒 **Protected:**
- `backup/v1-stable` - Don't delete this!
- `v1.0.0` tag - Keep for reference
