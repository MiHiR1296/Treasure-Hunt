-- QR Code System Migration
-- Run this in Supabase SQL Editor

-- Add QR code columns to checkpoints table
ALTER TABLE checkpoints
  ADD COLUMN IF NOT EXISTS qr_code_image_url text,
  ADD COLUMN IF NOT EXISTS qr_code_value text, -- Unique code for validation
  ADD COLUMN IF NOT EXISTS is_dud_qr boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS dud_message text DEFAULT 'Try again! This is not the right QR code.';

-- Generate unique QR codes for existing QR checkpoints
UPDATE checkpoints
SET qr_code_value = 'CHECKPOINT-' || id::text
WHERE unlock_method = 'qr_code' AND qr_code_value IS NULL;
