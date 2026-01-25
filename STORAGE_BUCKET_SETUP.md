# Storage Bucket Setup Guide

## Create `puzzle-images` Bucket

The puzzle hints system requires a Supabase storage bucket to store puzzle images. Follow these steps:

### Step 1: Create the Bucket

1. **Go to Supabase Dashboard**
   - Navigate to: https://supabase.com/dashboard/project/YOUR_PROJECT_ID
   - Replace `YOUR_PROJECT_ID` with your actual project ID

2. **Open Storage**
   - Click on **Storage** in the left sidebar
   - Click **New bucket** button

3. **Configure the Bucket**
   - **Name:** `puzzle-images` (must be exactly this name)
   - **Public bucket:** ✅ **CHECK THIS** (uncheck "Private bucket")
   - Click **Create bucket**

### Step 2: Set Storage Policies

After creating the bucket, you need to set up Row Level Security (RLS) policies:

1. **Go to Storage → `puzzle-images` → Policies**

2. **Add Public Read Policy** (so images can be viewed):
   - Click **New Policy**
   - Choose **For full customization**
   - Policy name: `Public read access`
   - Allowed operation: `SELECT`
   - Policy definition:
     ```sql
     (bucket_id = 'puzzle-images')
     ```
   - Click **Review** then **Save policy**

3. **Add Upload Policy** (so admin can upload images):
   - Click **New Policy** again
   - Choose **For full customization**
   - Policy name: `Anyone can upload`
   - Allowed operation: `INSERT`
   - Policy definition:
     ```sql
     (bucket_id = 'puzzle-images')
     ```
   - Click **Review** then **Save policy**

4. **Add Update Policy** (so admin can update images):
   - Click **New Policy** again
   - Choose **For full customization**
   - Policy name: `Anyone can update`
   - Allowed operation: `UPDATE`
   - Policy definition:
     ```sql
     (bucket_id = 'puzzle-images')
     ```
   - Click **Review** then **Save policy**

5. **Add Delete Policy** (so admin can delete images):
   - Click **New Policy** again
   - Choose **For full customization**
   - Policy name: `Anyone can delete`
   - Allowed operation: `DELETE`
   - Policy definition:
     ```sql
     (bucket_id = 'puzzle-images')
     ```
   - Click **Review** then **Save policy**

### Alternative: Using SQL Editor

If you prefer using SQL, run this in the SQL Editor:

```sql
-- Create the bucket (if it doesn't exist)
INSERT INTO storage.buckets (id, name, public)
VALUES ('puzzle-images', 'puzzle-images', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access
CREATE POLICY IF NOT EXISTS "Public read access"
ON storage.objects FOR SELECT
USING (bucket_id = 'puzzle-images');

-- Anyone can upload
CREATE POLICY IF NOT EXISTS "Anyone can upload"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'puzzle-images');

-- Anyone can update
CREATE POLICY IF NOT EXISTS "Anyone can update"
ON storage.objects FOR UPDATE
USING (bucket_id = 'puzzle-images')
WITH CHECK (bucket_id = 'puzzle-images');

-- Anyone can delete
CREATE POLICY IF NOT EXISTS "Anyone can delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'puzzle-images');
```

### Verify Setup

After creating the bucket and policies:

1. **Check bucket exists:**
   - Go to Storage → You should see `puzzle-images` in the list

2. **Test upload:**
   - Try uploading an image in the admin panel
   - The error should be gone

### Troubleshooting

- **"Bucket not found"**: The bucket doesn't exist - create it following Step 1
- **"Permission denied"**: The policies aren't set up - follow Step 2
- **"Bucket is private"**: Make sure you checked "Public bucket" when creating

### Important Notes

- The bucket name **must be exactly** `puzzle-images` (case-sensitive)
- The bucket **must be public** for images to be accessible
- All policies are needed for full functionality (read, upload, update, delete)
