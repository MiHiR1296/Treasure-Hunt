// Supabase Storage helpers for puzzle images

import { supabase } from '@/lib/supabase/client';

const BUCKET_NAME = 'puzzle-images';

export async function uploadPuzzleImage(file: File, checkpointId: string, stepId: string): Promise<string> {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${checkpointId}/${stepId}-${Date.now()}.${fileExt}`;
    const filePath = fileName;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath);

    return data.publicUrl;
  } catch (error: any) {
    console.error('Error uploading image:', error);
    throw new Error(`Failed to upload image: ${error.message}`);
  }
}

export async function deletePuzzleImage(filePath: string): Promise<void> {
  try {
    // Extract path from full URL
    const url = new URL(filePath);
    const pathParts = url.pathname.split('/');
    const fileName = pathParts[pathParts.length - 1];
    const folderPath = pathParts[pathParts.length - 2];
    const fullPath = `${folderPath}/${fileName}`;

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([fullPath]);

    if (error) throw error;
  } catch (error: any) {
    console.error('Error deleting image:', error);
    // Don't throw - deletion failures shouldn't block operations
  }
}
