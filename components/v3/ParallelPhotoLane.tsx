/* eslint-disable @next/next/no-img-element -- The preview is a local object URL from the participant's camera. */
'use client';

import { useEffect, useState } from 'react';
import { compressPhoto, photoRecord, type PendingPhoto } from '@/components/v2/player/photoStore';
import { newRequestId, V3RequestError, v3Request } from './api';
import { primaryButton } from './ui';

type UploadedMedia = { id: string; url: string; contentType: string; bytes: number };
type ParallelPendingPhoto = PendingPhoto & { laneSubmitted?: boolean };

async function uploadParallelMedia(form: FormData): Promise<{ media: UploadedMedia }> {
  const file = form.get('file');
  if (!(file instanceof Blob)) throw new Error('Choose a file to upload.');
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
  const metadata: Record<string, unknown> = {
    action: 'prepare_upload',
    requestId: form.get('requestId'),
    size: file.size,
    contentType: file.type,
    sha256,
  };
  for (const key of ['teamId', 'checkpointId', 'nodeId', 'mechanicId', 'laneId']) metadata[key] = form.get(key);
  if (form.has('location')) metadata.location = JSON.parse(String(form.get('location')));
  const prepared = await v3Request<{ mode?: 'multipart' | 'direct'; uploadUrl?: string; media?: UploadedMedia }>('/api/v3/media', { method: 'POST', body: JSON.stringify(metadata) });
  if (prepared.media) return { media: prepared.media };
  if (prepared.mode === 'multipart') return v3Request('/api/v3/media', { method: 'POST', body: form });
  if (prepared.mode !== 'direct' || !prepared.uploadUrl || new URL(prepared.uploadUrl).protocol !== 'https:') throw new Error('The upload could not be prepared. Please retry.');
  try {
    const response = await fetch(prepared.uploadUrl, { method: 'PUT', credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': file.type, 'x-upsert': 'false', 'Cache-Control': 'no-store' }, body: file, signal: AbortSignal.timeout(120_000) });
    await response.arrayBuffer();
  } catch { /* Finalization safely checks whether storage received the whole object. */ }
  return v3Request('/api/v3/media', { method: 'POST', body: JSON.stringify({ action: 'complete_upload', requestId: form.get('requestId') }) });
}

function currentLocation() {
  return new Promise<{ latitude: number; longitude: number; accuracyMeters: number }>((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This browser cannot check location.')); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy }),
      () => reject(new Error('Location is unavailable. Enable it, move into an open area, and retry.')),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

export default function ParallelPhotoLane({ teamId, runId, checkpointId, nodeId, mechanicId, laneId, disabled, onSubmit }: {
  teamId: string;
  runId: string;
  checkpointId: string;
  nodeId: string;
  mechanicId: string;
  laneId: string;
  disabled: boolean;
  onSubmit: (mediaId: string, requestId?: string) => Promise<'accepted' | 'rejected' | 'pending_review'>;
}) {
  const key = `v3-parallel:${teamId}:${runId}:${mechanicId}:${laneId}`;
  const [photo, setPhoto] = useState<ParallelPendingPhoto | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { void photoRecord(key).then(setPhoto).catch(() => undefined); }, [key]);
  useEffect(() => {
    if (!photo) { setPreview(''); return; }
    const url = URL.createObjectURL(photo.blob); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  const remember = async (next: ParallelPendingPhoto) => { setPhoto(next); await photoRecord(key, next).catch(() => undefined); };
  const choose = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true); setMessage('Preparing a smaller photo…');
    try { await remember({ key, requestId: newRequestId(), blob: await compressPhoto(file) }); setMessage('Photo ready for this lane.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The photo could not be prepared.'); }
    finally { setBusy(false); }
  };
  const upload = async (includeLocation: boolean) => {
    if (!photo || busy || disabled) return;
    setBusy(true); setMessage(includeLocation ? 'Checking location and sending photo…' : 'Sending photo…');
    let next = photo;
    try {
      if (includeLocation && !next.location) { next = { ...next, location: await currentLocation() }; await remember(next); }
      if (!next.mediaId) {
        const form = new FormData();
        form.append('file', next.blob, 'linked-lane.jpg');
        form.append('requestId', next.requestId);
        form.append('teamId', teamId);
        form.append('checkpointId', checkpointId);
        form.append('nodeId', nodeId);
        form.append('mechanicId', mechanicId);
        form.append('laneId', laneId);
        if (next.location) form.append('location', JSON.stringify(next.location));
        const result = await uploadParallelMedia(form);
        next = { ...next, mediaId: result.media.id };
        await remember(next);
      }
      const status = await onSubmit(next.mediaId!, next.requestId);
      next = { ...next, laneSubmitted: true };
      await remember(next);
      if (status === 'accepted') { await photoRecord(key, null).catch(() => undefined); setPhoto(null); }
      else if (status === 'pending_review') setMessage('Photo sent for organizer review. We will check approval automatically.');
      else setMessage('The photo was not approved. Check the organizer message, then take and send another photo.');
    } catch (error) {
      setMessage(error instanceof V3RequestError ? error.message : error instanceof Error ? error.message : 'The upload was interrupted. Retry the same photo.');
    } finally { setBusy(false); }
  };
  const check = async () => {
    if (!photo?.mediaId || busy) return;
    setBusy(true); setMessage('Checking organizer approval…');
    const status = await onSubmit(photo.mediaId, photo.laneSubmitted ? undefined : photo.requestId);
    if (!photo.laneSubmitted) await remember({ ...photo, laneSubmitted: true });
    if (status === 'accepted') { await photoRecord(key, null).catch(() => undefined); setPhoto(null); }
    else if (status === 'pending_review') setMessage('Still waiting for organizer approval. We will check again automatically; teammates can keep working on other lanes.');
    else setMessage('The photo was not approved. Check the organizer message, then take and send another photo.');
    setBusy(false);
  };
  useEffect(() => {
    if (!photo?.mediaId || disabled || busy) return;
    const timer = window.setInterval(() => { void check(); }, 5000);
    return () => window.clearInterval(timer);
  // `check` intentionally reads the latest local state on each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.mediaId, disabled, busy]);
  return <div className="space-y-3 rounded-2xl bg-stone-50 p-4">
    <p className="text-sm leading-relaxed text-stone-600">Take a clear lane photo. It stays private to your team and organizer until review.</p>
    <label className="block text-sm font-bold">Take or choose a photo<input type="file" accept="image/*" capture="environment" disabled={disabled || busy} onChange={event => void choose(event.target.files?.[0])} className="mt-2 block w-full text-sm file:mr-3 file:min-h-12 file:rounded-xl file:border-0 file:bg-white file:px-4 file:font-bold" /></label>
    {preview && <img src={preview} alt="Your linked-lane photo" className="max-h-72 w-full rounded-2xl object-contain" />}
    {photo && !photo.mediaId && <div className="grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => void upload(false)} disabled={disabled || busy} className={primaryButton}>{busy ? 'Sending…' : 'Send photo'}</button><button type="button" onClick={() => void upload(true)} disabled={disabled || busy} className="min-h-12 rounded-2xl border border-emerald-800 px-4 py-3 font-bold text-emerald-950 disabled:opacity-50">Send with location</button></div>}
    {photo?.mediaId && <button type="button" onClick={() => void check()} disabled={disabled || busy} className={primaryButton}>{busy ? 'Checking…' : 'Check photo approval'}</button>}
    {message && <p role="status" className="text-sm leading-relaxed text-stone-700">{message}</p>}
  </div>;
}
