# 🎯 Republic Day Treasure Hunt

A comprehensive web-based treasure hunt application for community events. Features team-based gameplay, multiple unlock methods, interactive puzzles, points system, and real-time leaderboards.

## ✨ Features

### 🎮 Core Gameplay
- **Anonymous Team Participation** - No login required, just team name and PIN
- **Team PIN System** - 4-digit PIN for secure team access
- **Team Members Tracking** - Track 4-6 members per team
- **Multiple Unlock Methods**:
  - 📷 **QR Code Scanning** - Scan QR codes at locations
  - 📍 **GPS Detection** - Automatic unlock when in range
  - 🔢 **Manual Code Entry** - Enter secret codes
- **Dud QR Codes** - Create fake QR codes to distract players
- **Progress Tracking** - Visual progress bar and checkpoint completion status
- **Real-time Leaderboard** - Live rankings sorted by points and checkpoints completed

### 🧩 Puzzle System
- **Puzzle Chains** - Multiple puzzle steps per checkpoint
- **6 Puzzle Types**:
  - 📝 **Text Clue** - Simple text-based clues
  - 🧩 **Jigsaw Puzzle** - Interactive image jigsaw puzzles
  - 🔢 **Sudoku** - 9x9 grid Sudoku puzzles
  - ✏️ **Crossword** - Image-based crossword puzzles
  - 🔍 **Word Search** - Interactive word finding puzzles
  - 🔄 **Circular Rotate** - Circular segment rotation puzzles
- **Answer Types** - Text input or QR code scanning for puzzle solutions
- **Optional Puzzles** - Puzzles can help find QR code locations or be standalone challenges

### 💰 Points System
- **Configurable Points** - Set points per checkpoint (default: 20)
- **Hint Penalties** - Each hint costs 5 points
- **Up to 3 Hints** - Teams can use up to 3 hints per checkpoint
- **Real-time Tracking** - See current points on checkpoint pages
- **Points Leaderboard** - Rankings based on total points earned

### 💡 Hints System
- **3-Tier Hints** - Up to 3 hints per checkpoint
- **Point Deduction** - 5 points per hint used
- **Pre/Post Unlock** - Hints available before or after unlocking checkpoint
- **Hint Tracking** - System tracks which hints have been used

### 🗺️ Map Features
- **Interactive Map View** - Visual map of all checkpoints
- **Color-Coded Markers**:
  - 🟢 Green - Completed checkpoints
  - 🔵 Blue - Current checkpoint
  - ⚪ Gray - Locked checkpoints
- **Leaflet Integration** - Professional mapping with zoom and pan

### 👥 Team Management
- **Create Teams** - Set team name and 4-digit PIN
- **Join Teams** - Join existing teams with name and PIN
- **Team Members** - Add 4-6 team members when creating/joining
- **Team Context** - Persistent team session across pages

### 🎛️ Admin Panel
- **Dashboard** - Overview stats (hunts, teams, checkpoints, progress)
- **Hunt Management**:
  - Create, edit, delete hunts
  - Set hunt status (draft, live, completed)
  - View all hunts with status indicators
- **Checkpoint Management**:
  - Create checkpoints with custom points
  - Edit checkpoint details
  - Delete checkpoints
  - Configure unlock methods (QR, GPS, manual code)
  - Set up puzzle chains
  - Configure hints (3 hints per checkpoint)
- **Team Management**:
  - View all teams
  - Edit team names
  - Delete teams
  - View team members
- **Dud QR Management**:
  - Create fake QR codes
  - Set custom error messages
  - Link to specific checkpoints
- **Puzzle Chain Builder**:
  - Add multiple puzzle steps
  - Configure puzzle types and settings
  - Upload puzzle images
  - Set answer types and values
  - Reorder puzzle steps
- **QR Code Generator** - Generate and download QR codes
- **Leaderboard View** - See top teams for each hunt

### 📱 User Experience
- **Mobile-Optimized** - Fully responsive design
- **Success Animations** - Confetti and checkmark animations
- **Error Handling** - Clear error messages and popups
- **Loading States** - Visual feedback during operations
- **Game Tips** - Helpful tips displayed to players
- **Team Members Display** - Show team members on hunt page

## 🛠️ Tech Stack

- **Framework**: Next.js 15 (App Router)
- **UI Library**: React 18
- **Database**: Supabase (PostgreSQL)
- **Styling**: TailwindCSS
- **Maps**: Leaflet
- **QR Scanner**: html5-qrcode
- **Puzzles**: react-jigsaw-puzzle (for jigsaw puzzles)
- **Language**: TypeScript

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- Supabase account (free tier works)
- Git (for cloning)

### Setup

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd ARhunt
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   Create `.env.local` in the root directory:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
   NEXT_PUBLIC_ADMIN_PASSWORD=your_admin_password
   ```

4. **Set up database:**
   - Go to Supabase Dashboard → SQL Editor
   - Run the SQL from `supabase/schema.sql`
   - Run any migration files in `supabase/migrations/` in order:
     - `add_points_system.sql`
     - `add_points_to_checkpoints.sql`
     - `add_points_earned_to_progress.sql`
     - `add_individual_points_tracking.sql`
     - `replace_clue_with_hints.sql`
     - `add_qr_code_system.sql`
     - `add_dud_qr_system.sql`
     - `add_pin_team_system.sql`
     - `add_puzzle_chain_system_safe.sql`
   - Run `supabase/admin_policies_safe.sql` for admin features

5. **Start development server:**
   ```bash
   npm run dev
   ```

6. **Access the app:**
   - Main app: http://localhost:3000
   - Admin panel: http://localhost:3000/admin

## 📖 How to Use

### For Players

#### 1. Join or Create a Team

1. Go to the home page
2. Click "Join the Hunt"
3. Enter your name
4. Choose to **Create Team** or **Join Team**:
   - **Create Team**: Enter team name and 4-digit PIN
   - **Join Team**: Enter existing team name and PIN
5. You'll be redirected to the hunts list

#### 2. Select a Hunt

1. View available hunts
2. Click on a live hunt to start
3. See your progress and current checkpoint

#### 3. Complete Checkpoints

**Unlocking a Checkpoint:**

1. Navigate to the current checkpoint
2. Unlock using one of these methods:
   - **QR Code**: Click "Scan QR Code" and scan the QR code at the location
   - **GPS**: Allow location access - automatically unlocks when in range
   - **Manual Code**: Enter the secret code displayed at the location
3. If puzzles are enabled, you can solve them first (optional) to get hints about the QR location

**Completing a Checkpoint:**

1. After unlocking, you'll see the checkpoint question/clue
2. Solve the puzzle or answer the question
3. Use hints if stuck (costs 5 points each, up to 3 hints)
4. Submit your answer
5. Earn points based on checkpoint value minus hint penalties

#### 4. Track Progress

- View progress bar showing completed checkpoints
- See completed checkpoints (marked with ✓)
- View current checkpoint to work on
- Check your team's total points
- View leaderboard to see rankings

#### 5. View Map

- Click "Map View" to see all checkpoints on an interactive map
- Checkpoints are color-coded by status
- Use map to plan your route

### For Administrators

#### 1. Access Admin Panel

1. Go to `/admin`
2. Enter admin password (set in `NEXT_PUBLIC_ADMIN_PASSWORD`)
3. Access dashboard with tabs: Dashboard, Hunts, Checkpoints, Teams

#### 2. Create a Hunt

1. Go to **Hunts** tab
2. Fill in:
   - Hunt Name
   - Description (optional)
   - Status: Select "live" for active hunts
3. Click "Create Hunt"
4. Hunt appears in the list

#### 3. Create Checkpoints

1. Go to **Checkpoints** tab
2. Select a hunt from dropdown
3. Fill in checkpoint details:
   - **Question/Title**: The checkpoint name
   - **Order Index**: Sequence number (1, 2, 3...)
   - **Description**: Additional context
   - **Points**: Points awarded (default: 20)
   - **Hints**: Add up to 3 hints (each costs 5 points)
   - **Unlock Method**: Choose QR Code, GPS, or Manual Code
4. **For QR Code**:
   - Enter QR code value
   - Optionally mark as "Dud QR" (fake QR code)
   - QR code image is auto-generated
5. **For GPS**:
   - Enter latitude and longitude
   - Set radius in meters (default: 50m)
6. **For Manual Code**:
   - Enter the secret code players need to type
7. **Puzzle Chain** (optional):
   - Check "Use Puzzle Chain"
   - Click "Add Step" to add puzzle steps
   - Configure each puzzle:
     - Select puzzle type
     - Upload image (for jigsaw, crossword, word search, circular rotate)
     - Set answer type (text or QR code)
     - Enter answer value
     - Add title and description
   - Reorder steps as needed
8. Click "Create Checkpoint"

#### 4. Manage Dud QR Codes

1. In **Checkpoints** tab, scroll to "Dud QR Codes" section
2. Enter QR code value
3. Set error message (shown when scanned)
4. Optionally link to a checkpoint
5. QR code image is auto-generated
6. Download and place at locations to distract players

#### 5. Manage Teams

1. Go to **Teams** tab
2. View all registered teams
3. **Edit**: Click "Edit" to change team name
4. **Delete**: Click "Delete" to remove team (deletes all progress)

#### 6. View Dashboard

- See statistics:
  - Total Hunts
  - Live Hunts
  - Total Teams
  - Total Checkpoints
  - Total Progress Entries
- View top 5 teams for each live hunt
- Click "View Full Leaderboard" for detailed rankings

#### 7. Edit/Delete Hunts

- **Edit**: Click "Edit" on any hunt, modify details, click "Update Hunt"
- **Delete**: Click "Delete" (warning: deletes all checkpoints and progress)

#### 8. Edit/Delete Checkpoints

- **Edit**: Click "Edit" on any checkpoint, modify details, click "Update Checkpoint"
- **Delete**: Click "Delete" (warning: deletes checkpoint and all progress)

## 🎯 Tutorial: Creating Your First Hunt

### Step 1: Set Up Database

1. Create a Supabase project
2. Run `supabase/schema.sql`
3. Run all migration files in order
4. Run `supabase/admin_policies_safe.sql`

### Step 2: Create Your First Hunt

1. Login to admin panel (`/admin`)
2. Go to **Hunts** tab
3. Create a hunt:
   - Name: "My First Treasure Hunt"
   - Description: "Explore the neighborhood!"
   - Status: "live"
4. Click "Create Hunt"

### Step 3: Add Checkpoints

**Checkpoint 1: QR Code Checkpoint**

1. Select your hunt in **Checkpoints** tab
2. Create checkpoint:
   - Title: "Starting Point"
   - Order: 1
   - Points: 20
   - Unlock Method: QR Code
   - QR Code Value: "START001"
   - Hint 1: "Look near the entrance"
   - Hint 2: "Check the welcome sign"
   - Hint 3: "It's at eye level"
3. Download the generated QR code
4. Print and place at your first location

**Checkpoint 2: GPS Checkpoint**

1. Create checkpoint:
   - Title: "Main Square"
   - Order: 2
   - Points: 25
   - Unlock Method: GPS
   - Latitude: [get from Google Maps]
   - Longitude: [get from Google Maps]
   - Radius: 50 meters
   - Hint 1: "You're in the right place!"
   - Hint 2: "Look for the fountain"
   - Hint 3: "Check the benches"

**Checkpoint 3: Manual Code with Puzzle Chain**

1. Create checkpoint:
   - Title: "Puzzle Challenge"
   - Order: 3
   - Points: 30
   - Unlock Method: Manual Code
   - Manual Code: "PUZZLE2024"
   - Check "Use Puzzle Chain"
   - Add puzzle step:
     - Type: Jigsaw Puzzle
     - Upload image
     - Answer Type: Text
     - Answer: "SOLUTION"
   - Add another step:
     - Type: Word Search
     - Upload image
     - Answer Type: QR Code
     - Answer: [QR code value]
2. Place the manual code at the location

### Step 4: Test as Player

1. Open app in incognito/private window
2. Go to `/join`
3. Create a test team
4. Select your hunt
5. Test unlocking checkpoints
6. Verify points, hints, and leaderboard work

### Step 5: Add Dud QR Codes (Optional)

1. In admin panel, go to **Checkpoints** tab
2. Scroll to "Dud QR Codes"
3. Create dud QR:
   - Value: "FAKE001"
   - Message: "Nice try! This isn't the right QR code."
4. Print and place at wrong locations

## 📱 Mobile Testing

The app is fully mobile-optimized. Test on:
- iOS Safari
- Android Chrome
- Responsive design works on all screen sizes

See `MOBILE_TESTING.md` for detailed mobile testing guide.

## 🚀 Deployment

See `DEPLOY_NOW.md` for step-by-step deployment instructions to Vercel.

### Quick Deploy

1. Push code to GitHub
2. Connect to Vercel
3. Add environment variables
4. Deploy!

## 📚 Documentation

- `DEPLOY_NOW.md` - Deployment guide
- `NEXT_STEPS_COMPLETE.md` - Setup and usage guide
- `MOBILE_TESTING.md` - Testing on mobile devices
- `ADMIN_FEATURES.md` - Admin panel features
- `PUZZLE_IMPLEMENTATION_SUMMARY.md` - Puzzle system details
- `TEAM_MEMBERS_SETUP.md` - Team members feature

## 🎮 Game Flow

```
1. Player joins/creates team
   ↓
2. Selects a live hunt
   ↓
3. Views current checkpoint
   ↓
4. Unlocks checkpoint (QR/GPS/Code)
   ↓
5. Solves puzzle/answers question
   ↓
6. (Optional) Uses hints (costs points)
   ↓
7. Completes checkpoint (earns points)
   ↓
8. Moves to next checkpoint
   ↓
9. Completes all checkpoints
   ↓
10. Wins! 🎉
```

## 🔒 Security Features

- Admin password protection
- Team PIN system
- Row Level Security (RLS) in Supabase
- Secure QR code validation
- GPS location verification

## 🎨 UI/UX Features

- **Responsive Design** - Works on all devices
- **Real-time Updates** - Live leaderboard and progress
- **Visual Feedback** - Success animations, error popups
- **Progress Indicators** - Progress bars, completion status
- **Color Coding** - Visual status indicators
- **Accessibility** - Clear labels and instructions

## 🐛 Troubleshooting

### QR Scanner Not Working
- Ensure camera permissions are granted
- Use HTTPS in production (required for camera access)
- Test on mobile device (better camera support)

### GPS Not Unlocking
- Check location permissions
- Verify coordinates are correct
- Ensure radius is appropriate (try larger radius)

### Points Not Updating
- Check database migrations are run
- Verify `points_earned` column exists in `progress` table
- Check browser console for errors

### Admin Panel Not Loading
- Verify admin password in `.env.local`
- Check Supabase connection
- Ensure admin policies are set up

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please feel free to submit issues or pull requests.

---

**Built with ❤️ for community treasure hunts**
