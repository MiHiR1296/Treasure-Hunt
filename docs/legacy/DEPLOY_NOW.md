# 🚀 Deploy Your Treasure Hunt - Step by Step

## Your GitHub: https://github.com/MiHiR1296

## Step 1: Create GitHub Repository

1. Go to: https://github.com/new
2. **Repository name**: `treasure-hunt` (or any name you like)
3. **Description**: "Republic Day Treasure Hunt - Lokdhara, Kalyan East"
4. **Visibility**: 
   - **Public** (free Vercel requires public repos) OR
   - **Private** (if you have Vercel Pro/paid account)
5. **DO NOT** initialize with README, .gitignore, or license
6. Click **"Create repository"**

## Step 2: Push Code to GitHub

Run these commands in your terminal:

```bash
cd /Users/mihirbotle/Desktop/Personal/ARhunt

# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - Republic Day Treasure Hunt app"

# Add your GitHub repository (replace REPO_NAME with what you created)
git remote add origin https://github.com/MiHiR1296/REPO_NAME.git

# Push to GitHub
git branch -M main
git push -u origin main
```

**Replace `REPO_NAME` with the repository name you created in Step 1**

## Step 3: Deploy to Vercel

1. **Go to Vercel**: https://vercel.com
2. **Sign up/Login**:
   - Click "Sign Up"
   - Choose "Continue with GitHub"
   - Authorize Vercel to access your GitHub

3. **Import Project**:
   - Click **"Add New Project"** (or "Import Project")
   - You'll see your GitHub repositories
   - Find and click **"Import"** next to your `treasure-hunt` repository

4. **Configure Project**:
   - **Framework Preset**: Next.js (should be auto-detected)
   - **Root Directory**: `./` (leave as default)
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `.next` (default)
   - **Install Command**: `npm install` (default)

5. **Add Environment Variables** (IMPORTANT!):
   - Click **"Environment Variables"** section
   - Add these **three variables**:
   
     **Variable 1:**
     - Name: `NEXT_PUBLIC_SUPABASE_URL`
     - Value: `https://wjvezuqrygbzbvnoyxuk.supabase.co`
     - Environments: ✅ Production, ✅ Preview, ✅ Development
   
     **Variable 2:**
     - Name: `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - Value: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqdmV6dXFyeWdiemJ2bm95eHVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwNzIxMjIsImV4cCI6MjA4NDY0ODEyMn0.LrmHLig5HvISl5xvf5vgatrihb5bFKw0Hv9bJzfY7JY`
     - Environments: ✅ Production, ✅ Preview, ✅ Development
   
     **Variable 3:**
     - Name: `NEXT_PUBLIC_ADMIN_PASSWORD`
     - Value: `admin123` (or change to something more secure)
     - Environments: ✅ Production, ✅ Preview, ✅ Development

6. **Deploy**:
   - Click **"Deploy"** button
   - Wait 2-3 minutes for build to complete

## Step 4: Get Your Live URL

Once deployment completes:
- You'll see: **"Congratulations! Your project has been deployed"**
- Your URL will be: `https://treasure-hunt-XXXXX.vercel.app`
- Or a custom name if you set one

**Copy this URL - this is your live treasure hunt!** 🎉

## Step 5: Test Your Deployed App

1. Open your Vercel URL in browser
2. Test admin panel: `https://your-app.vercel.app/admin`
3. Login with password: `admin123`
4. Create a hunt
5. Test on your phone - open the URL on mobile browser

## ✅ After Deployment

### Update Admin Password (Security)

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Edit `NEXT_PUBLIC_ADMIN_PASSWORD`
3. Change to a secure password
4. Redeploy (or it auto-updates)

### Share with Players

Just share the Vercel URL! Players can:
- ✅ Access from anywhere
- ✅ Use on any device
- ✅ QR scanner works (HTTPS required)
- ✅ GPS works (HTTPS required)
- ✅ No Wi-Fi restrictions!

## 🎯 Quick Commands Reference

If you need to update and redeploy:

```bash
# Make changes to your code
git add .
git commit -m "Your update message"
git push

# Vercel automatically redeploys!
```

## 🆘 Troubleshooting

**Build fails:**
- Check build logs in Vercel dashboard
- Make sure all dependencies are in `package.json`
- Check for TypeScript errors

**Environment variables not working:**
- Make sure they start with `NEXT_PUBLIC_` for client-side
- Redeploy after adding variables

**Can't see repository in Vercel:**
- Make sure repository is public (or you have Vercel Pro)
- Refresh Vercel dashboard
- Check GitHub permissions in Vercel settings

## 🎉 You're Done!

Once deployed, you have a live web link that works everywhere!

Share it with your Republic Day event participants! 🚀
