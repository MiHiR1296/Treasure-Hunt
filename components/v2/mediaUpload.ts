export interface UploadedMedia { id: string; url: string; contentType: string; bytes: number }
type UploadResponse = { mode?: 'multipart' | 'direct'; uploadUrl?: string; media?: UploadedMedia };
type SendUpload = (body: FormData | Record<string, unknown>) => Promise<UploadResponse>;

/** The app authorizes and validates uploads; only file bytes go to private storage. */
export async function uploadMedia(form: FormData, send: SendUpload): Promise<{ media: UploadedMedia }> {
  const file = form.get('file');
  if (!(file instanceof Blob)) throw new Error('Choose a file to upload.');
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
  const metadata: Record<string, unknown> = { action: 'prepare_upload', requestId: form.get('requestId'), size: file.size, contentType: file.type, sha256 };
  for (const key of ['teamId', 'checkpointId', 'nodeId']) if (form.has(key)) metadata[key] = form.get(key);
  if (form.has('location')) metadata.location = JSON.parse(String(form.get('location')));
  const prepared = await send(metadata);
  if (prepared.media) return { media: prepared.media };
  if (prepared.mode === 'multipart') {
    const result = await send(form);
    if (!result.media) throw new Error('The upload could not be confirmed. Retry the same file.');
    return { media: result.media };
  }
  if (prepared.mode !== 'direct' || !prepared.uploadUrl || new URL(prepared.uploadUrl).protocol !== 'https:') throw new Error('The upload could not be prepared. Please retry.');
  try {
    // Do not send application cookies or authorization headers to storage.
    // A lost response or an already-uploaded object is resolved by finalization.
    const response = await fetch(prepared.uploadUrl, { method: 'PUT', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': file.type, 'x-upsert': 'false', 'Cache-Control': 'no-store' }, body: file, signal: AbortSignal.timeout(120_000) });
    await response.body?.cancel();
  } catch { /* The server checks whether the complete file actually arrived. */ }
  const result = await send({ action: 'complete_upload', requestId: form.get('requestId') });
  if (!result.media) throw new Error('The upload could not be confirmed. Retry the same file.');
  return { media: result.media };
}
