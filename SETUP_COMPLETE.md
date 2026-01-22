# ✅ Setup Complete - Next Steps

## Your Supabase Credentials

- **Project URL**: https://wjvezuqrygbzbvnoyxuk.supabase.co
- **Project ID**: wjvezuqrygbzbvnoyxuk
- **Project Name**: TreasureHunt

## ⚠️ Important: Verify Your API Key

The key format you provided (`sb_publishable_...`) looks different from standard Supabase keys. Please verify:

1. Go to: https://supabase.com/dashboard/project/wjvezuqrygbzbvnoyxuk
2. Click **Settings** → **API**
3. Look for **"anon public"** key
4. Standard Supabase keys are JWT tokens starting with `eyJ...`

If your key doesn't start with `eyJ`, use the one from the dashboard.

## 📋 Step-by-Step Setup

### Step 1: Create Environment File

Create `.env.local` in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://wjvezuqrygbzbvnoyxuk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_fCAANjDS5LjmlRp6xtB7aQ_kZRgrziF
NEXT_PUBLIC_ADMIN_PASSWORD=admin123
```

**Or use the script:**
```bash
./scripts/setup-env.sh
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Set Up Database (CRITICAL!)

1. **Open Supabase Dashboard**: https://supabase.com/dashboard/project/wjvezuqrygbzbvnoyxuk
2. **Click "SQL Editor"** in left sidebar
3. **Click "New query"**
4. **Open** the file `supabase/schema.sql` from this project
5. **Copy ALL** the SQL code (lines 1-92)
6. **Paste** into the SQL Editor
7. **Click "Run"** button (or press Cmd/Ctrl + Enter)

You should see: "Success. No rows returned"

This creates:
- ✅ `teams` table
- ✅ `hunts` table  
- ✅ `checkpoints` table
- ✅ `progress` table
- ✅ `hint_requests` table
- ✅ All security policies

### Step 4: Test Connection

```bash
npm run dev
```

Then open: http://localhost:3000

Or test the connection directly:
```bash
npx tsx scripts/test-connection.ts
```

### Step 5: Create Your First Hunt

1. Go to: http://localhost:3000/admin
2. Login with password: `admin123`
3. **Create Hunt:**
   - Name: "Republic Day Treasure Hunt"
   - Description: "Explore iconic spots in Lokdhara, Kalyan East"
   - Status: **live** (important!)
   - Click "Create Hunt"

4. **Select the hunt** from dropdown

5. **Add Checkpoints** - For each location:

   **Example:**
   ```
   Title: Local Temple
   Order: 1
   Description: Visit the main temple
   Clue: "Where people gather to pray, find the next clue near the main gate"
   Hint: "Look for a sign with the temple's name"
   Unlock Method: GPS
   Latitude: 19.2433
   Longitude: 73.1356
   Radius: 50 meters
   ```

   Repeat for all locations in Lokdhara.

## 📍 Getting GPS Coordinates

1. Open Google Maps
2. Search: "Lokdhara, Kalyan East, Maharashtra"
3. Find your location
4. Right-click → Click coordinates
5. Copy latitude and longitude
6. Use in admin panel

## 🎯 Quick Test

1. Open http://localhost:3000 in **incognito/private window**
2. Click "Join the Hunt"
3. Enter team name: "Test Team"
4. Select your hunt
5. Try unlocking first checkpoint

## 🚀 Ready for Event!

Once you've:
- ✅ Added all checkpoints
- ✅ Set hunt status to "live"
- ✅ Tested on mobile device

You're ready! Share the URL with participants.

## 📱 Mobile Testing

**Important:** Test on a real mobile device:
- QR scanning requires camera
- GPS works better on real devices
- Use your local network IP or deploy to test

To get local IP:
```bash
# Mac/Linux
ipconfig getifaddr en0

# Then access: http://YOUR_IP:3000
```

## 🆘 Troubleshooting

**"Invalid API key"**
→ Get correct key from Supabase Dashboard → Settings → API → anon public

**"Table does not exist"**
→ Make sure you ran the SQL schema in Supabase SQL Editor

**QR Scanner not working**
→ Test on mobile device with HTTPS (or localhost)

**GPS not working**
→ Grant location permissions, test outdoors

## 📞 All Set!

Your treasure hunt app is ready. Follow the steps above and you'll be hosting your Republic Day event in no time!

For more details, see:
- `QUICK_START.md` - Quick reference
- `COMPLETE_SETUP.md` - Detailed guide
- `README.md` - Full documentation
