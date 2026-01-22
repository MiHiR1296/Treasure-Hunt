# 🚀 Quick Start - Republic Day Treasure Hunt

## Immediate Next Steps

### 1. Create `.env.local` file

Create a file named `.env.local` in the root directory:

```env
NEXT_PUBLIC_SUPABASE_URL=https://wjvezuqrygbzbvnoyxuk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_fCAANjDS5LjmlRp6xtB7aQ_kZRgrziF
NEXT_PUBLIC_ADMIN_PASSWORD=admin123
```

**⚠️ Important:** If the key format doesn't work, get the correct key:
1. Go to https://supabase.com/dashboard/project/wjvezuqrygbzbvnoyxuk
2. Click **Settings** → **API**
3. Copy the **"anon public"** key (should be a long JWT starting with `eyJ`)
4. Replace the `NEXT_PUBLIC_SUPABASE_ANON_KEY` value

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Database

1. Go to: https://supabase.com/dashboard/project/wjvezuqrygbzbvnoyxuk
2. Click **SQL Editor** → **New query**
3. Open `supabase/schema.sql` from this project
4. Copy **ALL** the SQL code
5. Paste into SQL Editor
6. Click **Run** (or Cmd/Ctrl + Enter)

### 4. Start the App

```bash
npm run dev
```

Open http://localhost:3000

### 5. Create Your Hunt

1. Go to http://localhost:3000/admin
2. Login with password: `admin123`
3. Create a hunt named "Republic Day Treasure Hunt"
4. Add checkpoints with Lokdhara locations

## 📍 Adding Lokdhara Locations

For each checkpoint, you'll need:

**For GPS checkpoints:**
- Find location on Google Maps
- Right-click → Get coordinates
- Enter in admin panel

**For QR code checkpoints:**
- Generate QR code with a unique value (e.g., "LOKDHARA001")
- Print and place at location
- Enter the value in admin panel

**For manual code checkpoints:**
- Write a code at the location (e.g., "TEMPLE2024")
- Enter the same code in admin panel

## ✅ Test It Works

1. Open http://localhost:3000 in a new incognito window
2. Click "Join the Hunt"
3. Enter team name: "Test Team"
4. Try unlocking your first checkpoint

## 🎉 You're Ready!

Once you've added all checkpoints and set the hunt status to "live", share the URL with participants!

For detailed instructions, see `COMPLETE_SETUP.md`
