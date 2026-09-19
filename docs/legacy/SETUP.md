# Quick Setup Guide

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Create a new project (choose a region close to India, e.g., ap-south-1)
3. Go to **SQL Editor** → **New query**
4. Copy the entire contents of `supabase/schema.sql`
5. Paste and click **Run**

This creates all the necessary tables and security policies.

## Step 3: Get Supabase Credentials

1. In Supabase dashboard, go to **Settings** → **API**
2. Copy:
   - **Project URL** (this is your `NEXT_PUBLIC_SUPABASE_URL`)
   - **anon public** key (this is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

## Step 4: Create Environment File

Create a file named `.env.local` in the root directory:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_project_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
NEXT_PUBLIC_ADMIN_PASSWORD=your_secure_password_here
```

Replace the values with your actual Supabase credentials.

## Step 5: Run the App

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Step 6: Create Your First Hunt

1. Go to [http://localhost:3000/admin](http://localhost:3000/admin)
2. Login with your admin password
3. Click "Create New Hunt":
   - Name: "Republic Day Treasure Hunt"
   - Description: "Explore Lokdhara, Kalyan East"
   - Status: "live"
4. Select the hunt you just created
5. Add checkpoints:
   - For each checkpoint, enter:
     - Title (e.g., "Local Temple")
     - Order index (1, 2, 3...)
     - Clue text (the riddle)
     - Unlock method (QR code, GPS, or manual code)
     - Corresponding data based on unlock method

## For GPS Checkpoints

You'll need the latitude and longitude of locations in Lokdhara, Kalyan East. You can find these using:
- Google Maps (right-click on location → coordinates)
- Or use a tool like [latlong.net](https://www.latlong.net)

Example coordinates for Kalyan area:
- Latitude: 19.2433
- Longitude: 73.1356

## Testing

1. Open the app in an incognito/private window (to simulate a new player)
2. Click "Join the Hunt"
3. Enter a team name
4. Try unlocking a checkpoint using the method you configured

## Deployment

When ready to deploy:

1. Push code to GitHub
2. Import to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy!

The app will work on any device - just share the URL with participants.
