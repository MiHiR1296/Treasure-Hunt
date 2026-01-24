-- Dud QR Code System Migration
-- Run this in Supabase SQL Editor

-- Create dud_qr_codes table for managing dud QR codes per hunt
CREATE TABLE IF NOT EXISTS dud_qr_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hunt_id uuid REFERENCES hunts(id) ON DELETE CASCADE,
  checkpoint_id uuid REFERENCES checkpoints(id) ON DELETE SET NULL,
  qr_code_value text NOT NULL UNIQUE,
  qr_code_image_url text,
  dud_message text DEFAULT 'Try again! This is not the right QR code.',
  created_at timestamptz DEFAULT now()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_dud_qr_codes_hunt 
ON dud_qr_codes (hunt_id);

CREATE INDEX IF NOT EXISTS idx_dud_qr_codes_checkpoint 
ON dud_qr_codes (checkpoint_id) WHERE checkpoint_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dud_qr_codes_value 
ON dud_qr_codes (qr_code_value);

-- Enable Row Level Security
ALTER TABLE dud_qr_codes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Anyone can read dud QR codes (needed for validation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'dud_qr_codes' 
    AND policyname = 'Dud QR codes are viewable by everyone'
  ) THEN
    CREATE POLICY "Dud QR codes are viewable by everyone" 
    ON dud_qr_codes FOR SELECT USING (true);
  END IF;
END $$;

-- Anyone can create dud QR codes (admin functionality)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'dud_qr_codes' 
    AND policyname = 'Anyone can create dud QR codes'
  ) THEN
    CREATE POLICY "Anyone can create dud QR codes" 
    ON dud_qr_codes FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- Anyone can update dud QR codes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'dud_qr_codes' 
    AND policyname = 'Anyone can update dud QR codes'
  ) THEN
    CREATE POLICY "Anyone can update dud QR codes" 
    ON dud_qr_codes FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Anyone can delete dud QR codes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'dud_qr_codes' 
    AND policyname = 'Anyone can delete dud QR codes'
  ) THEN
    CREATE POLICY "Anyone can delete dud QR codes" 
    ON dud_qr_codes FOR DELETE USING (true);
  END IF;
END $$;
