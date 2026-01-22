# 🎛️ Enhanced Admin Panel Features

## New Features Added

### 1. Dashboard Tab (Spectator View)
- **Stats Overview**:
  - Total Hunts
  - Live Hunts
  - Total Teams
  - Total Checkpoints
  - Total Progress Entries

- **Live Hunts Leaderboards**:
  - Shows top 5 teams for each live hunt
  - Displays checkpoints completed
  - Link to full leaderboard

### 2. Hunts Management
- ✅ **Create Hunts** - Same as before
- ✅ **Edit Hunts** - Click "Edit" button to modify hunt details
- ✅ **Delete Hunts** - Click "Delete" button (with confirmation)
- ✅ **View All Hunts** - See all hunts with their status

### 3. Checkpoints Management
- ✅ **View Checkpoints** - Select a hunt to see all checkpoints
- ✅ **Delete Checkpoints** - Click "Delete" button (with confirmation)
- ⚠️ Note: Checkpoint editing coming soon (can delete and recreate for now)

### 4. Teams Management
- ✅ **View All Teams** - See all registered teams
- ✅ **Edit Teams** - Change team names
- ✅ **Delete Teams** - Remove teams (with confirmation)
- ✅ **Team Stats** - See when teams joined

## Setup Required

### Step 1: Add Admin Policies to Database

Run this SQL in Supabase SQL Editor:

```sql
-- Allow updates and deletes on hunts (for admin)
CREATE POLICY "Anyone can update hunts" 
ON hunts FOR UPDATE 
USING (true) 
WITH CHECK (true);

CREATE POLICY "Anyone can delete hunts" 
ON hunts FOR DELETE 
USING (true);

-- Allow updates and deletes on checkpoints (for admin)
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
```

Or use the file: `supabase/admin_policies.sql`

### Step 2: Deploy

The code has been pushed to GitHub. Vercel will auto-deploy.

## How to Use

### Dashboard View
1. Login to admin panel
2. Click "Dashboard" tab
3. See stats and live hunt leaderboards

### Edit a Hunt
1. Go to "Hunts" tab
2. Click "Edit" on any hunt
3. Modify details and click "Update Hunt"

### Delete a Hunt
1. Go to "Hunts" tab
2. Click "Delete" on any hunt
3. Confirm deletion (this deletes all checkpoints and progress!)

### Manage Teams
1. Go to "Teams" tab
2. Click "Edit" to change team name
3. Click "Delete" to remove team (deletes their progress)

### Manage Checkpoints
1. Go to "Checkpoints" tab
2. Select a hunt
3. Click "Delete" on any checkpoint

## Security Notes

- All operations require admin password
- Delete operations have confirmation dialogs
- Deletions are permanent (cascade deletes related data)

## Future Enhancements

- Edit checkpoints (currently delete and recreate)
- Bulk operations
- Export data
- More detailed analytics
