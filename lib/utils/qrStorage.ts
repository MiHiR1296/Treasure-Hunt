// Supabase Storage helpers for QR code images

import { supabase } from '@/lib/supabase/client';

const BUCKET_NAME = 'qr-codes';

/**
 * Upload QR code image to Supabase Storage
 * @param qrCodeDataUrl - Data URL of the QR code image (from canvas or SVG)
 * @param checkpointId - ID of the checkpoint
 * @returns Public URL of the uploaded QR code image
 */
export async function uploadQRCode(
  qrCodeDataUrl: string,
  checkpointId: string
): Promise<string> {
  try {
    // Convert data URL to blob
    const response = await fetch(qrCodeDataUrl);
    const blob = await response.blob();
    
    // Create file name
    const fileName = `${checkpointId}/qr-code-${Date.now()}.png`;
    const filePath = fileName;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, blob, {
        cacheControl: '3600',
        upsert: true, // Replace if exists
        contentType: 'image/png',
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath);

    return data.publicUrl;
  } catch (error: any) {
    console.error('Error uploading QR code:', error);
    throw new Error(`Failed to upload QR code: ${error.message}`);
  }
}

/**
 * Delete QR code image from Supabase Storage
 * @param checkpointId - ID of the checkpoint
 */
export async function deleteQRCode(checkpointId: string): Promise<void> {
  try {
    // List all files in the checkpoint folder
    const { data: files, error: listError } = await supabase.storage
      .from(BUCKET_NAME)
      .list(checkpointId);

    if (listError) {
      // If folder doesn't exist, that's okay
      if (listError.message.includes('not found')) {
        return;
      }
      throw listError;
    }

    if (!files || files.length === 0) {
      return; // No files to delete
    }

    // Delete all files in the checkpoint folder
    const filePaths = files.map(file => `${checkpointId}/${file.name}`);
    const { error: deleteError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove(filePaths);

    if (deleteError) throw deleteError;
  } catch (error: any) {
    console.error('Error deleting QR code:', error);
    // Don't throw - deletion failures shouldn't block operations
  }
}
