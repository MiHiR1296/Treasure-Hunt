# Puzzle Chain System Setup Guide

## Database Setup

1. **Run the migration SQL:**
   - Go to your Supabase Dashboard → SQL Editor
   - Open `supabase/migrations/add_puzzle_chain_system.sql`
   - Copy and paste the entire contents
   - Click "Run" to execute

2. **Create Storage Bucket:**
   - Go to Supabase Dashboard → Storage
   - Click "New bucket"
   - Name: `puzzle-images`
   - Make it **Public** (uncheck "Private bucket")
   - Click "Create bucket"

3. **Set Storage Policies:**
   - Go to Storage → `puzzle-images` → Policies
   - Add policy for public read access:
     ```sql
     CREATE POLICY "Public Access"
     ON storage.objects FOR SELECT
     USING (bucket_id = 'puzzle-images');
     ```
   - Add policy for authenticated uploads (for admin):
     ```sql
     CREATE POLICY "Authenticated users can upload"
     ON storage.objects FOR INSERT
     WITH CHECK (bucket_id = 'puzzle-images');
     ```

## Installing Dependencies

The following packages should be installed:
- `react-jigsaw-puzzle` - For jigsaw puzzles
- `sudoku-core` - For sudoku validation
- `react-highlight-words` - For word highlighting
- `react-beautiful-dnd` - For step reordering in admin (optional)

Run:
```bash
npm install react-jigsaw-puzzle sudoku-core react-highlight-words react-beautiful-dnd
```

## Usage

### Creating a Puzzle Chain Checkpoint

1. Go to Admin Panel → Checkpoints
2. Select a hunt
3. Fill in checkpoint details
4. **Check "Use Puzzle Chain"** checkbox
5. Click "Add Step" to add puzzle steps
6. For each step:
   - Select puzzle type
   - Configure puzzle settings
   - Upload image if needed
   - Set answer type (Text or QR Code)
   - Enter answer value
7. Click "Create Checkpoint"

### Puzzle Types

1. **Text Clue** - Simple text riddle/clue
2. **Jigsaw Puzzle** - Image split into pieces (requires image upload)
3. **Sudoku** - 9x9 grid puzzle (enter solution)
4. **Crossword** - Image-based crossword (requires image + answers)
5. **Word Search** - Find words in grid (requires image + word list)
6. **Circular Rotate** - Rotate circular segments (requires image + rotation angles)

### Answer Types

- **Text Answer**: User enters a word/text answer
- **QR Code**: User scans a QR code to proceed

## Notes

- Puzzle chains are sequential - users must complete each step before moving to the next
- Progress is saved automatically
- Images are stored in Supabase Storage
- Existing checkpoints without puzzle chains continue to work normally
