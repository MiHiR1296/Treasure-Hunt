/* eslint-disable @next/next/no-img-element -- The preview is a local object URL from the participant's camera. */
'use client';

import { useEffect, useRef, useState } from 'react';
import type { PlayerNode } from '@/lib/engine/types';
import type { SendCommand } from '@/components/v2/CurrentTask';
import { uploadMedia } from '@/components/v2/mediaUpload';
import { compressPhoto, photoRecord, type PendingPhoto } from '@/components/v2/player/photoStore';
import { newRequestId, V3RequestError, v3Request } from './api';
import { primaryButton } from './ui';

export default function V3PhotoVerification({ teamId, runId, checkpointId, node, disabled, send }: {
  teamId: string;
  runId: string;
  checkpointId: string;
  node: Extract<PlayerNode, { type: 'verify_image' }>;
  disabled: boolean;
  send: SendCommand;
}) {
  const key = `v3:${teamId}:${runId}:${checkpointId}:${node.id}`;
  const [photo, setPhoto] = useState<PendingPhoto | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void photoRecord(key).then(saved => { if (mounted.current && node.photoStatus !== 'pending') setPhoto(saved); }).catch(() => undefined);
    return () => { mounted.current = false; };
  }, [key, node.photoStatus]);
  useEffect(() => {
    if (!photo) { setPreview(''); return; }
    const url = URL.createObjectURL(photo.blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  useEffect(() => {
    if (node.photoStatus !== 'pending') return;
    setPhoto(null);
    void photoRecord(key, null).catch(() => undefined);
  }, [key, node.photoStatus]);

  const remember = async (value: PendingPhoto) => {
    setPhoto(value);
    try { await photoRecord(key, value); }
    catch { setMessage('Device storage is unavailable. Keep this page open until the photo is sent.'); }
  };
  const choose = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true); setMessage('Preparing a smaller photo…');
    try {
      const blob = await compressPhoto(file);
      if (mounted.current) {
        await remember({ key, requestId: newRequestId(), blob });
        setMessage('Photo ready. Send it when the whole landmark is visible.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The photo could not be prepared. Try another image.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  const upload = async () => {
    if (!photo || busy || disabled) return;
    setBusy(true); setMessage('Sending your photo…');
    let current = photo;
    try {
      if (node.locationRequired && !current.location) {
        const location = await new Promise<NonNullable<PendingPhoto['location']>>((resolve, reject) => {
          if (!navigator.geolocation) { reject(new Error('Location access is needed for this checkpoint. Ask your organizer for help.')); return; }
          navigator.geolocation.getCurrentPosition(
            ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy }),
            () => reject(new Error('Location is unavailable. Enable it and retry, or ask your organizer for help.')),
            { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
          );
        });
        current = { ...current, location };
        await remember(current);
      }
      if (!current.mediaId) {
        const form = new FormData();
        form.append('file', current.blob, 'landmark.jpg');
        form.append('requestId', current.requestId);
        form.append('teamId', teamId);
        form.append('checkpointId', checkpointId);
        form.append('nodeId', node.id);
        if (current.location) form.append('location', JSON.stringify(current.location));
        const result = await uploadMedia(form, body => v3Request('/api/v3/media', {
          method: 'POST',
          body: body instanceof FormData ? body : JSON.stringify(body),
        }));
        current = { ...current, mediaId: result.media.id };
        await remember(current);
      }
      const feedback = await send({ type: 'submit_photo', checkpointId, nodeId: node.id, mediaId: current.mediaId! });
      if (feedback) {
        await photoRecord(key, null).catch(() => undefined);
        setPhoto(null);
        setMessage('Photo sent. Your organizer will review it.');
      } else setMessage('Your photo is uploaded. Use Retry last action to confirm its submission.');
    } catch (error) {
      if (error instanceof V3RequestError) {
        setMessage(error.message);
        if (!current.mediaId && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
          current = { ...current, requestId: newRequestId(), location: undefined };
          await remember(current);
        }
      } else {
        setMessage(error instanceof Error && error.message.startsWith('Location ') ? error.message : 'The upload was interrupted. Retry with the same photo when your connection returns.');
      }
    } finally { if (mounted.current) setBusy(false); }
  };

  if (node.photoStatus === 'pending') return <p role="status" className="rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">Your photo is waiting for organizer review. You can safely return later; the run continues after approval.</p>;
  return <div className="space-y-3">
    {node.photoStatus === 'rejected' && <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">{node.reviewMessage || 'Please try another photo showing the whole landmark.'}</p>}
    <p className="text-sm leading-relaxed text-stone-600">Take a clear photo showing the landmark. It is resized before upload and stays private to your crew and organizer.{node.locationRequired ? ' This checkpoint also checks your approximate location.' : ''}</p>
    <label className="block text-sm font-bold text-stone-800">Take or choose a photo<input type="file" accept="image/*" capture="environment" disabled={disabled || busy} onChange={event => void choose(event.target.files?.[0])} className="mt-2 block w-full text-sm file:mr-3 file:min-h-12 file:rounded-xl file:border-0 file:bg-stone-100 file:px-4 file:font-bold" /></label>
    {preview && <img src={preview} alt="Your photo ready for review" className="max-h-80 w-full rounded-2xl object-contain" />}
    {photo && <button type="button" disabled={disabled || busy} onClick={() => void upload()} className={primaryButton}>{busy ? 'Sending…' : photo.mediaId ? 'Confirm photo submission' : 'Send photo for review'}</button>}
    {message && <p role="status" className="text-sm leading-relaxed text-stone-700">{message}</p>}
  </div>;
}
