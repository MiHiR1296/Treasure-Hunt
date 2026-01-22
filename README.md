# 🎯 Republic Day Treasure Hunt

A simple web-based treasure hunt app for community events in Lokdhara, Kalyan East, Maharashtra.

## Features

- ✅ Anonymous team participation (no login required)
- ✅ Multiple unlock methods: QR codes, GPS detection, manual codes
- ✅ Real-time leaderboard
- ✅ Interactive map view
- ✅ Hints system for stuck teams
- ✅ Progress tracking
- ✅ Admin panel for creating hunts and checkpoints

## Tech Stack

- Next.js 15 (App Router)
- React 18
- Supabase (Database)
- TailwindCSS
- Leaflet (Maps)
- html5-qrcode (QR Scanner)

## Quick Start

### Prerequisites

- Node.js 18+ installed
- Supabase account (free tier works)

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   Create `.env.local`:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
   NEXT_PUBLIC_ADMIN_PASSWORD=your_admin_password
   ```

3. **Set up database:**
   - Go to Supabase Dashboard → SQL Editor
   - Run the SQL from `supabase/schema.sql`

4. **Start development server:**
   ```bash
   npm run dev
   ```

5. **Access the app:**
   - Main app: http://localhost:3000
   - Admin panel: http://localhost:3000/admin

## Deployment

See `DEPLOY_NOW.md` for step-by-step deployment instructions to Vercel.

## Documentation

- `DEPLOY_NOW.md` - Deployment guide
- `NEXT_STEPS_COMPLETE.md` - Setup and usage guide
- `MOBILE_TESTING.md` - Testing on mobile devices

## License

MIT
