# Fix npm Install & Continue Setup

## The npm install error is a permissions issue. Here's how to fix it:

### Option 1: Run npm install manually (Recommended)

Open your terminal and run:

```bash
cd /Users/mihirbotle/Desktop/Personal/ARhunt
npm install
```

If you still get permission errors, try:

```bash
sudo npm install
```

### Option 2: Use npx (if npm install still fails)

You can try using npx directly:

```bash
npx next dev
```

This will install dependencies on-the-fly.

## After npm install succeeds:

### Step 4: Start the Development Server

```bash
npm run dev
```

You should see:
```
▲ Next.js 15.x.x
- Local:        http://localhost:3000
```

### Step 5: Test the App

1. Open http://localhost:3000 in your browser
2. You should see the landing page

### Step 6: Test Admin Panel

1. Go to http://localhost:3000/admin
2. Login with password: `admin123`
3. You should see the admin panel

### Step 7: Create Your First Hunt

In the admin panel:

1. **Create Hunt:**
   - Name: "Republic Day Treasure Hunt"
   - Description: "Explore iconic spots in Lokdhara, Kalyan East"
   - Status: Select **"live"**
   - Click "Create Hunt"

2. **Select the hunt** from the dropdown

3. **Add Your First Checkpoint:**
   - Title: "Checkpoint 1" (or name of first location)
   - Order Index: 1
   - Description: "First location in Lokdhara"
   - Clue Text: "Your first clue here - this leads to the next location"
   - Hint Text (optional): "A helpful hint if teams get stuck"
   - Unlock Method: Choose one:
     - **GPS**: Enter lat/lng of location, radius 50m
     - **QR Code**: Enter a code like "LOKDHARA001"
     - **Manual Code**: Enter code like "TEMPLE2024"
   - Click "Create Checkpoint"

4. **Add More Checkpoints** - Repeat for each location

### Step 8: Test as a Player

1. Open http://localhost:3000 in a **new incognito/private window**
2. Click "Join the Hunt"
3. Enter team name: "Test Team"
4. Select your hunt
5. Try unlocking the first checkpoint

## Getting GPS Coordinates for Lokdhara

1. Open Google Maps
2. Search: "Lokdhara, Kalyan East, Maharashtra"
3. Find your location
4. Right-click on the exact spot
5. Click on the coordinates that appear
6. Copy latitude and longitude
7. Use in admin panel

## Troubleshooting

**If npm install still fails:**
- Try: `npm cache clean --force` then `npm install`
- Or: `rm -rf node_modules package-lock.json` then `npm install`

**If you see "Module not found" errors:**
- Make sure `npm install` completed successfully
- Check that `node_modules` folder exists

**If Supabase connection fails:**
- Verify `.env.local` file exists with correct credentials
- Check that database schema was run in Supabase SQL Editor
- Verify your API key is correct (should be JWT starting with `eyJ`)

## Next Steps After Setup

Once everything works:
1. Add all your Lokdhara checkpoints
2. Test on a mobile device
3. Deploy to Vercel for the event
4. Share the URL with participants!
