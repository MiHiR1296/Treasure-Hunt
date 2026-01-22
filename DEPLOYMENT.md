# 🚀 Deploy to Vercel - Make It Accessible Everywhere

## Why Deploy?

Once deployed, players can access your treasure hunt from **anywhere** with just a web link - no need to be on the same Wi-Fi!

You'll get a URL like: `https://your-app-name.vercel.app`

## Quick Deployment Steps

### Step 1: Push to GitHub

1. **Create a GitHub account** (if you don't have one): https://github.com
2. **Create a new repository**:
   - Go to https://github.com/new
   - Name it: `treasure-hunt` (or any name)
   - Make it **Public** (free Vercel requires public repos) or **Private** (if you have Vercel Pro)
   - Click "Create repository"

3. **Push your code to GitHub:**

```bash
cd /Users/mihirbotle/Desktop/Personal/ARhunt

# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - Treasure Hunt app"

# Add your GitHub repository (replace YOUR_USERNAME and REPO_NAME)
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git

# Push to GitHub
git branch -M main
git push -u origin main
```

### Step 2: Deploy to Vercel

1. **Go to Vercel**: https://vercel.com
2. **Sign up/Login** (you can use GitHub to sign in)
3. **Click "Add New Project"**
4. **Import your GitHub repository**:
   - Select your `treasure-hunt` repository
   - Click "Import"
5. **Configure Project**:
   - Framework Preset: **Next.js** (auto-detected)
   - Root Directory: `./` (default)
   - Build Command: `npm run build` (default)
   - Output Directory: `.next` (default)
6. **Add Environment Variables**:
   - Click "Environment Variables"
   - Add these three:
     ```
     NEXT_PUBLIC_SUPABASE_URL = https://wjvezuqrygbzbvnoyxuk.supabase.co
     NEXT_PUBLIC_SUPABASE_ANON_KEY = sb_publishable_fCAANjDS5LjmlRp6xtB7aQ_kZRgrziF
     NEXT_PUBLIC_ADMIN_PASSWORD = admin123
     ```
   - Make sure to select "Production", "Preview", and "Development"
7. **Click "Deploy"**

### Step 3: Wait for Deployment

- Vercel will build and deploy your app
- Takes 2-3 minutes
- You'll get a URL like: `https://treasure-hunt-abc123.vercel.app`

### Step 4: Test Your Deployed App

1. Open your Vercel URL in browser
2. Test the admin panel: `https://your-app.vercel.app/admin`
3. Test as a player: Join a hunt
4. **Test on your phone**: Open the URL on mobile browser

## ✅ After Deployment

### Update Admin Password

For security, change the admin password:

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Update `NEXT_PUBLIC_ADMIN_PASSWORD` to something secure
3. Redeploy (or it will auto-update)

### Share with Players

Just share the URL! Players can:
- Access from any device
- Use QR scanner (works on HTTPS)
- Use GPS (works on HTTPS)
- No Wi-Fi restrictions!

## 🔒 Security Notes

- The admin password is in environment variables (secure)
- Supabase has Row Level Security (RLS) enabled
- Only you can create hunts via admin panel
- Players can only see their own progress

## 📱 Testing on Mobile After Deployment

1. Open the Vercel URL on your phone
2. Test QR scanning (HTTPS required)
3. Test GPS (works better on HTTPS)
4. Test all features

## 🎯 Custom Domain (Optional)

If you have a domain:
1. Go to Vercel → Your Project → Settings → Domains
2. Add your domain
3. Follow DNS instructions
4. Your app will be at: `https://yourdomain.com`

## 🆘 Troubleshooting

**Build fails:**
- Check build logs in Vercel dashboard
- Make sure all dependencies are in `package.json`
- Check for TypeScript errors

**Environment variables not working:**
- Make sure they start with `NEXT_PUBLIC_` for client-side access
- Redeploy after adding variables

**Supabase connection fails:**
- Verify API key is correct
- Check Supabase project is active
- Make sure database schema is set up

## 💡 Pro Tips

- **Automatic deployments**: Every push to GitHub auto-deploys
- **Preview deployments**: Each PR gets its own URL
- **Free tier**: Perfect for your event (unlimited deployments)
- **Analytics**: Vercel shows visitor stats

## 🎉 You're Done!

Once deployed, you have:
- ✅ Public web link
- ✅ Works on any device
- ✅ HTTPS (required for camera/GPS)
- ✅ No Wi-Fi restrictions
- ✅ Easy to share

Share the link and your Republic Day treasure hunt is live! 🚀
