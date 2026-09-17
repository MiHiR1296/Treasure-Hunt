# Team Members Feature - Setup Guide

## ✅ What's Been Added

1. **Team Members Collection** - Teams must have 4-6 members
2. **Checkpoint Creation Fixed** - Can now create checkpoints in admin panel
3. **Mobile-Optimized UI** - All pages now work great on mobile devices

## 📋 Database Setup Required

### Step 1: Create Team Members Table

Run this SQL in Supabase SQL Editor:

```sql
-- Team members table
create table team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  name text not null,
  order_index int not null,
  created_at timestamptz default now()
);

create index on team_members (team_id);

-- RLS policies
alter table team_members enable row level security;
create policy "Team members are viewable by everyone" on team_members for select using (true);
create policy "Anyone can create team members" on team_members for insert with check (true);
create policy "Anyone can update team members" on team_members for update using (true);
create policy "Anyone can delete team members" on team_members for delete using (true);
```

Or use the file: `supabase/team_members_schema.sql`

## 🎯 How It Works

### For Players (Join Page)

1. Enter team name
2. Enter team member names (minimum 4, maximum 6)
3. Can add/remove member slots
4. All members are saved when team is created

### For Admins

- **Teams Tab**: Now shows team members for each team
- **Checkpoints Tab**: Can now create checkpoints (was missing before!)
- **Mobile-Friendly**: All admin features work on mobile

## 📱 Mobile Improvements

All pages are now optimized for mobile:
- ✅ Responsive text sizes (smaller on mobile)
- ✅ Touch-friendly buttons (larger tap targets)
- ✅ Flexible layouts (stacks on mobile, side-by-side on desktop)
- ✅ QR scanner adjusts to screen size
- ✅ Admin tabs scroll horizontally on mobile
- ✅ Forms are mobile-friendly

## 🧪 Testing

1. **Test Team Registration**:
   - Go to join page
   - Enter team name
   - Add 4-6 member names
   - Submit

2. **Test Checkpoint Creation**:
   - Go to admin panel
   - Click "Checkpoints" tab
   - Select a hunt
   - Fill in checkpoint form
   - Create checkpoint

3. **Test on Mobile**:
   - Open on phone
   - Test all features
   - Check that everything is readable and usable

## 🚀 Deployment

Code has been pushed to GitHub. Vercel will auto-deploy.

After deployment:
1. Run the team_members SQL schema
2. Test team registration with members
3. Test checkpoint creation
4. Test on mobile devices

## 📝 Notes

- Team members are optional (if table doesn't exist, app still works)
- Minimum 4 members enforced in UI
- Maximum 6 members enforced in UI
- Members are displayed in admin Teams tab
