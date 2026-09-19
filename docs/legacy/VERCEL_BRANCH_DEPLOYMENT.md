# Vercel Branch Deployment Guide

## Current Situation

You're on branch: `feature/puzzle-chain-system`
- **This branch is NOT deployed to production yet**
- **Your main branch is what's currently live on Vercel**

## How Vercel Deploys Branches

### Default Behavior

1. **Production Deployment (Main Branch)**
   - Only the `main` branch deploys to production
   - URL: `https://your-app.vercel.app` (your live site)
   - **This is what players see right now**
   - **The puzzle chain feature is NOT in production yet**

2. **Preview Deployments (Other Branches)**
   - Vercel can create preview deployments for other branches
   - Each branch/PR gets its own preview URL
   - Example: `https://your-app-git-feature-puzzle-chain-system.vercel.app`
   - **These are separate from production**

## What's Currently Deployed

✅ **Production (main branch):**
- Your current live app
- Without puzzle chain system
- Players see this version

❌ **Feature Branch (feature/puzzle-chain-system):**
- NOT deployed yet (unless you push it)
- Only exists locally on your machine
- Needs to be pushed to GitHub first

## Deployment Scenarios

### Scenario 1: Push Feature Branch (Preview Deployment)

If you push the feature branch to GitHub:

```bash
git push -u origin feature/puzzle-chain-system
```

**What happens:**
- ✅ Vercel creates a **preview deployment**
- ✅ You get a preview URL (separate from production)
- ✅ Production stays unchanged (still on main branch)
- ✅ You can test the puzzle chain feature on the preview URL
- ✅ Players still see the old version (main branch)

**Preview URL format:**
```
https://your-app-git-feature-puzzle-chain-system.vercel.app
```

### Scenario 2: Merge to Main (Production Deployment)

When you merge the feature branch to main:

```bash
git checkout main
git merge feature/puzzle-chain-system
git push origin main
```

**What happens:**
- ✅ Vercel automatically deploys main branch to production
- ✅ Your live site gets the puzzle chain feature
- ✅ Players see the new version
- ⚠️ **This is when the feature goes live**

### Scenario 3: Keep Branch Local (No Deployment)

If you don't push the branch:
- ❌ Nothing gets deployed
- ❌ Production stays on main
- ✅ Safe for testing locally

## Vercel Configuration

### Check Your Vercel Settings

1. Go to Vercel Dashboard → Your Project → Settings → Git
2. Check "Production Branch" - should be `main`
3. Check "Preview Deployments" - usually enabled by default

### Preview Deployment Settings

Vercel automatically creates preview deployments for:
- ✅ All branches pushed to GitHub
- ✅ Pull requests
- ✅ Each gets its own URL

You can disable this in Settings → Git → "Preview Deployments"

## Recommended Workflow

### Step 1: Test Locally (Current State)
```bash
# You're here now - testing on feature branch locally
npm run dev
# Test the puzzle chain feature
```

### Step 2: Push for Preview (Optional)
```bash
git push -u origin feature/puzzle-chain-system
# Get a preview URL to test on Vercel
# Production still uses main branch
```

### Step 3: Test Preview Deployment
- Test the preview URL
- Make sure everything works
- Production is still safe

### Step 4: Merge to Main (When Ready)
```bash
git checkout main
git merge feature/puzzle-chain-system
git push origin main
# Now production gets updated
```

## Safety Checklist

Before merging to main:
- [ ] Tested locally on feature branch
- [ ] Tested on preview deployment (if pushed)
- [ ] Database migration run in Supabase
- [ ] All puzzle types tested
- [ ] Mobile testing done
- [ ] No breaking changes for existing checkpoints

## Current Status

**Right Now:**
- ✅ Feature branch created locally
- ✅ Changes committed locally
- ❌ Not pushed to GitHub yet
- ❌ Not deployed to Vercel yet
- ✅ Production is safe (still on main)

**To Deploy:**
1. Push branch → Get preview URL (safe, doesn't affect production)
2. Test preview → Make sure it works
3. Merge to main → Deploy to production (when ready)

## Quick Commands

```bash
# See current branch
git branch

# Push feature branch (creates preview deployment)
git push -u origin feature/puzzle-chain-system

# Switch back to main (production)
git checkout main

# Merge feature to main (deploys to production)
git merge feature/puzzle-chain-system
git push origin main

# Revert if needed (before merging)
git checkout main
git branch -D feature/puzzle-chain-system
```

## Summary

**Your production site (main branch) is safe!**

- The feature branch only exists locally
- Pushing it creates a preview (doesn't affect production)
- Only merging to main updates production
- You have full control over when to deploy
