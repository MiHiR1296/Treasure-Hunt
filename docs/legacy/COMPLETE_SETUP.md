# Complete Setup Instructions

## ✅ Step 1: Create Environment File

Create a file named `.env.local` in the root directory with these contents:

```env
NEXT_PUBLIC_SUPABASE_URL=https://wjvezuqrygbzbvnoyxuk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_fCAANjDS5LjmlRp6xtB7aQ_kZRgrziF
NEXT_PUBLIC_ADMIN_PASSWORD=admin123
```

**Important Note:** The key you provided looks different from standard Supabase keys. If you get authentication errors, please:
1. Go to your Supabase Dashboard → Settings → API
2. Copy the **"anon public"** key (it should be a JWT token starting with `eyJ`)
3. Replace `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` with that key

## ✅ Step 2: Install Dependencies

```bash
npm install
```

## ✅ Step 3: Set Up Database Schema

1. Go to your Supabase Dashboard: https://supabase.com/dashboard/project/wjvezuqrygbzbvnoyxuk
2. Click on **SQL Editor** in the left sidebar
3. Click **New query**
4. Open the file `supabase/schema.sql` from this project
5. Copy the **entire contents** of that file
6. Paste it into the SQL Editor
7. Click **Run** (or press Cmd/Ctrl + Enter)

This will create all the necessary tables:
- `teams` - Team names
- `hunts` - Treasure hunts
- `checkpoints` - Checkpoint locations
- `progress` - Team progress tracking
- `hint_requests` - Hint usage tracking

## ✅ Step 4: Test the Connection

Run the test script to verify everything is set up correctly:

```bash
npx tsx scripts/test-connection.ts
```

Or start the dev server and check:

```bash
npm run dev
```

Then open http://localhost:3000

## ✅ Step 5: Create Your First Hunt

1. Go to http://localhost:3000/admin
2. Login with password: `admin123` (or whatever you set in .env.local)
3. Click **"Create New Hunt"**:
   - **Name**: "Republic Day Treasure Hunt"
   - **Description**: "Explore iconic spots in Lokdhara, Kalyan East"
   - **Status**: Select "live"
   - Click **"Create Hunt"**

4. **Select the hunt** you just created from the dropdown

5. **Add Checkpoints** - For each location in Lokdhara:

   **Example Checkpoint 1:**
   - Title: "Local Temple"
   - Order Index: 1
   - Description: "Visit the main temple in Lokdhara"
   - Clue Text: "Where people gather to pray, find the next clue near the main gate"
   - Hint Text (optional): "Look for a sign with the temple's name"
   - Unlock Method: Choose one:
     - **GPS**: Enter latitude (19.2433), longitude (73.1356), radius (50 meters)
     - **QR Code**: Generate a QR code with value like "TEMPLE001" and place it at location
     - **Manual Code**: Enter code like "TEMPLE2024" that players will find written somewhere

   **Example Checkpoint 2:**
   - Title: "Community Center"
   - Order Index: 2
   - Clue Text: "Where the community meets, check the notice board"
   - ... (continue for all locations)

## 📍 Getting GPS Coordinates for Lokdhara Locations

1. Open Google Maps
2. Search for the location in Lokdhara, Kalyan East
3. Right-click on the exact spot → Click on the coordinates
4. Copy the latitude and longitude
5. Use these in the admin panel for GPS-based checkpoints

## 🎯 Quick Test

1. Open http://localhost:3000 in an incognito window
2. Click "Join the Hunt"
3. Enter team name: "Test Team"
4. Select your hunt
5. Try unlocking the first checkpoint

## 🚀 Deployment

When ready to deploy:

1. Push code to GitHub
2. Go to https://vercel.com
3. Import your GitHub repository
4. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_ADMIN_PASSWORD`
5. Deploy!

## ⚠️ Troubleshooting

**"Invalid API key" error:**
- The key format you provided might not be correct
- Get the actual "anon public" key from Supabase Dashboard → Settings → API
- It should be a long JWT token starting with `eyJ`

**"Table does not exist" error:**
- Make sure you ran the SQL schema in Supabase SQL Editor
- Check that all tables were created successfully

**QR Scanner not working:**
- Make sure you're testing on a mobile device or enable camera permissions
- Use HTTPS in production (required for camera access)

**GPS not working:**
- Grant location permissions in browser
- Test on a real device (not localhost)
- GPS works better outdoors

## 📞 Need Help?

Check the main README.md for more details on features and usage.
