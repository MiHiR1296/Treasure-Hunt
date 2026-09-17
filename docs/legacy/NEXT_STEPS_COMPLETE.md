# ✅ Next Steps - You're Almost There!

## ✅ What You've Done:
1. ✅ Fixed API key (now using correct JWT format)
2. ✅ Ran SQL to add INSERT policy for hunts
3. ✅ Environment file updated

## 🚀 Next Steps:

### Step 1: Restart Your Dev Server

**Stop the current server** (if running) by pressing `Ctrl+C` in the terminal, then:

```bash
npm run dev
```

Wait for it to start (you'll see "Ready" message).

### Step 2: Test Creating a Hunt

1. **Open browser**: http://localhost:3000/admin
2. **Login** with password: `admin123`
3. **Create a hunt**:
   - Name: "Republic Day Treasure Hunt"
   - Description: "Explore iconic spots in Lokdhara, Kalyan East"
   - Status: **"live"**
   - Click "Create Hunt"

**It should work now!** ✅

If you still get an error, check the browser console (F12) - the improved error handling will show details.

### Step 3: Add Your First Checkpoint

1. **Select your hunt** from the dropdown
2. **Fill in checkpoint details**:
   - **Title**: "Checkpoint 1" (or name of first location)
   - **Order Index**: 1
   - **Description**: "First location in Lokdhara"
   - **Clue Text**: "Your first clue here - this leads to the next location"
   - **Hint Text** (optional): "A helpful hint if teams get stuck"
   - **Unlock Method**: Choose one:
     - **GPS**: 
       - Latitude: Get from Google Maps
       - Longitude: Get from Google Maps  
       - Radius: 50 meters
     - **QR Code**: 
       - QR Code Value: "LOKDHARA001"
     - **Manual Code**: 
       - Manual Code: "TEMPLE2024"
3. Click **"Create Checkpoint"**

### Step 4: Test as a Player

1. Open **http://localhost:3000** in a **new incognito window**
2. Click **"Join the Hunt"**
3. Enter team name: **"Test Team"**
4. Select **"Republic Day Treasure Hunt"**
5. Try unlocking your first checkpoint!

### Step 5: Deploy to Vercel (Get Web Link)

Once everything works locally, deploy so players can access from anywhere:

#### 5a. Push to GitHub

```bash
# Initialize git (if not done)
git init

# Add all files
git add .

# Commit
git commit -m "Treasure hunt app ready for deployment"

# Create GitHub repo at https://github.com/new
# Then add remote (replace YOUR_USERNAME and REPO_NAME):
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git

# Push
git branch -M main
git push -u origin main
```

#### 5b. Deploy to Vercel

1. Go to: https://vercel.com
2. Sign up/Login (use GitHub)
3. Click **"Add New Project"**
4. **Import your GitHub repository**
5. **Add Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://wjvezuqrygbzbvnoyxuk.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqdmV6dXFyeWdiemJ2bm95eHVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwNzIxMjIsImV4cCI6MjA4NDY0ODEyMn0.LrmHLig5HvISl5xvf5vgatrihb5bFKw0Hv9bJzfY7JY`
   - `NEXT_PUBLIC_ADMIN_PASSWORD` = `admin123`
6. Click **"Deploy"**

Wait 2-3 minutes, then you'll get a URL like:
**`https://your-app-name.vercel.app`**

### Step 6: Share with Players! 🎉

Once deployed:
- ✅ Share the Vercel URL
- ✅ Players can access from anywhere
- ✅ Works on any device
- ✅ HTTPS (required for camera/GPS)

## 📍 Getting GPS Coordinates for Lokdhara

1. Open **Google Maps**
2. Search: **"Lokdhara, Kalyan East, Maharashtra"**
3. Find your exact location
4. **Right-click** on the spot
5. Click on the **coordinates**
6. Copy **latitude** and **longitude**
7. Use in admin panel

## 🎯 Quick Checklist

- [ ] Server restarted with new API key
- [ ] Can access admin panel
- [ ] Successfully created a hunt
- [ ] Added at least one checkpoint
- [ ] Tested as a player
- [ ] Can unlock checkpoint
- [ ] Deployed to Vercel
- [ ] Tested on mobile device

## 💡 Tips

- **Test everything locally first** before deploying
- **Add all checkpoints** before the event
- **Test on mobile** after deployment (QR and GPS work better)
- **Change admin password** in Vercel environment variables for security

You're doing great! 🚀
