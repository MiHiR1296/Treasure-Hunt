# 🔧 Quick Fix for Admin Error

## Most Likely Issue: Wrong API Key

The key you're using (`sb_publishable_...`) is **not a standard Supabase key**. 

### Fix It Now:

1. **Get the correct key:**
   - Go to: https://supabase.com/dashboard/project/wjvezuqrygbzbvnoyxuk
   - Click **Settings** → **API**
   - Copy the **"anon public"** key (should start with `eyJ...`)

2. **Update `.env.local`:**
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://wjvezuqrygbzbvnoyxuk.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... (paste the correct key here)
   NEXT_PUBLIC_ADMIN_PASSWORD=admin123
   ```

3. **Restart server:**
   ```bash
   # Stop server (Ctrl+C)
   npm run dev
   ```

4. **Try creating hunt again**

## Also Check: Database Schema

Make sure you ran the SQL schema. If not:

1. Go to Supabase → SQL Editor
2. Run the updated schema (I just added INSERT policy for hunts)
3. Or run this quick fix:
   ```sql
   CREATE POLICY "Anyone can create hunts" 
   ON hunts FOR INSERT 
   WITH CHECK (true);
   ```

## Check Browser Console

After fixing, open browser console (F12) and try creating a hunt. You'll now see detailed error messages that will help debug.

## For Deployment (Web Link)

See `DEPLOYMENT.md` for full instructions. Quick version:

1. Push code to GitHub
2. Go to vercel.com
3. Import repository
4. Add environment variables
5. Deploy!

You'll get a URL like: `https://your-app.vercel.app`

Players can access from anywhere! 🚀
