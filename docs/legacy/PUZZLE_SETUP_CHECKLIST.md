# Puzzle Chain System - Setup Checklist

## ✅ Pre-Implementation Checklist

- [x] Database migration SQL created
- [x] All puzzle components implemented
- [x] Admin panel integration complete
- [x] Checkpoint page integration complete
- [x] Progress tracking implemented
- [x] TypeScript types defined
- [x] Storage utilities created

## 📋 Setup Steps

### 1. Database Setup

- [ ] Run `supabase/migrations/add_puzzle_chain_system.sql` in Supabase SQL Editor
- [ ] Verify tables created: `puzzle_steps`, `puzzle_progress`
- [ ] Verify `use_puzzle_chain` column added to `checkpoints` table
- [ ] Verify RLS policies are active

### 2. Storage Setup

- [ ] Create `puzzle-images` bucket in Supabase Storage
- [ ] Set bucket to **Public** (not private)
- [ ] Add public read policy:
  ```sql
  CREATE POLICY "Public Access"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'puzzle-images');
  ```
- [ ] Add authenticated upload policy:
  ```sql
  CREATE POLICY "Authenticated users can upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'puzzle-images');
  ```

### 3. Dependencies

- [ ] Run `npm install` to install all packages
- [ ] Verify packages installed:
  - `react-jigsaw-puzzle`
  - `sudoku-core`
  - `react-highlight-words`
  - `react-beautiful-dnd`

### 4. Configuration

- [ ] Verify `next.config.ts` has image remote patterns for Supabase
- [ ] Test image loading from Supabase Storage

### 5. Testing

#### Admin Panel
- [ ] Create a checkpoint with puzzle chain
- [ ] Add multiple puzzle steps
- [ ] Test each puzzle type:
  - [ ] Text clue
  - [ ] Jigsaw puzzle (upload image)
  - [ ] Sudoku (enter solution)
  - [ ] Crossword (upload image + answers)
  - [ ] Word search (upload image + words)
  - [ ] Circular rotate (upload image + rotations)
- [ ] Test step reordering
- [ ] Test step deletion
- [ ] Test image upload
- [ ] Test answer types (text and QR code)
- [ ] Save checkpoint
- [ ] Edit existing checkpoint with puzzle chain

#### Player Experience
- [ ] Unlock a checkpoint with puzzle chain
- [ ] Complete first puzzle step
- [ ] Verify progress indicator updates
- [ ] Complete second puzzle step
- [ ] Test text answer submission
- [ ] Test QR code answer submission
- [ ] Complete entire chain
- [ ] Verify checkpoint completion
- [ ] Test page reload (should resume from last step)
- [ ] Test on mobile device

### 6. Edge Cases

- [ ] Test checkpoint with no puzzle steps (should show error)
- [ ] Test checkpoint with single puzzle step
- [ ] Test checkpoint with 5+ puzzle steps
- [ ] Test mixed answer types (text + QR in same chain)
- [ ] Test puzzle without answer (auto-solved)
- [ ] Test incorrect answer submission
- [ ] Test image loading errors

## 🐛 Troubleshooting

### Images not loading
- Check Supabase Storage bucket is public
- Verify image URLs are correct
- Check `next.config.ts` remote patterns
- Verify CORS settings in Supabase

### Puzzle steps not saving
- Check RLS policies on `puzzle_steps` table
- Verify checkpoint ID is correct
- Check browser console for errors

### Progress not persisting
- Check RLS policies on `puzzle_progress` table
- Verify team ID is set correctly
- Check database for progress entries

### Jigsaw puzzle not working
- Verify `react-jigsaw-puzzle` package is installed
- Check image URL is accessible
- Try different image format (JPG/PNG)

## 📝 Notes

- All puzzle images should be optimized before upload
- Recommended image sizes:
  - Jigsaw: 800x800px or larger
  - Crossword: 1000x1000px
  - Word Search: 1000x1000px
  - Circular Rotate: 1:1 ratio, 800x800px
- Sudoku solutions should be 81 numbers (9x9 grid)
- Circular rotations are in degrees (0-360)

## 🎉 Success Criteria

- [ ] Can create checkpoint with puzzle chain in admin
- [ ] Can add/edit/delete puzzle steps
- [ ] Can upload images for puzzles
- [ ] Players can complete puzzle chains
- [ ] Progress is saved and persists
- [ ] All puzzle types work correctly
- [ ] Mobile experience is smooth
- [ ] Backward compatibility maintained (old checkpoints still work)
