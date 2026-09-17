/* eslint-disable @next/next/no-img-element -- Organizer and device image assets use their original access-controlled URLs. */
'use client'

import { useEffect, useRef, useState } from 'react'
import type { PlayerNode } from '@/lib/engine/types'
import type { SendCommand } from '../CurrentTask'
import { isPreviewSession, newRequestId, PlayerRequestError, playerRequest } from '../sessionClient'
import { compressPhoto, photoRecord, type PendingPhoto } from './photoStore'

export default function PhotoVerification({ teamId, checkpointId, node, disabled, send }: { teamId: string; checkpointId: string; node: Extract<PlayerNode, { type: 'verify_image' }>; disabled: boolean; send: SendCommand }) {
  const key = `${isPreviewSession() ? 'preview' : 'live'}:${teamId}:${checkpointId}:${node.id}`
  const [photo, setPhoto] = useState<PendingPhoto | null>(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    void photoRecord(key).then(saved => { if (mounted.current && node.photoStatus !== 'pending') setPhoto(saved) }).catch(() => undefined)
    return () => { mounted.current = false }
  }, [key, node.photoStatus])
  useEffect(() => {
    if (!photo) { setPreview(''); return }
    const url = URL.createObjectURL(photo.blob); setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])
  useEffect(() => { if (node.photoStatus === 'pending') { setPhoto(null); void photoRecord(key, null).catch(() => undefined) } }, [key, node.photoStatus])
  const remember = async (value: PendingPhoto) => {
    setPhoto(value)
    try { await photoRecord(key, value) } catch { setMessage('Device storage is unavailable. Keep this page open until the photo is sent.') }
  }
  const choose = async (file?: File) => {
    if (!file || busy) return
    setBusy(true); setMessage('Preparing a smaller photo…')
    try { const blob = await compressPhoto(file); if (mounted.current) { await remember({ key, requestId: newRequestId(), blob }); setMessage('Photo ready. Send it when you are happy with the image.') } }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'The photo could not be prepared. Try another image.') }
    finally { if (mounted.current) setBusy(false) }
  }
  const upload = async () => {
    if (!photo || busy || disabled) return
    setBusy(true); setMessage('Sending your photo…')
    let current = photo
    try {
      if (node.locationRequired && !current.location) {
        const location = await new Promise<NonNullable<PendingPhoto['location']>>((resolve, reject) => {
          if (!navigator.geolocation) { reject(new Error('Location access is needed for this checkpoint. Ask your organizer for help.')); return }
          navigator.geolocation.getCurrentPosition(({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy }), () => reject(new Error('Location is unavailable. Enable location access and retry, or ask your organizer for help.')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
        })
        current = { ...current, location }; await remember(current)
      }
      if (!current.mediaId) {
        const form = new FormData()
        form.append('file', current.blob, 'landmark.jpg'); form.append('requestId', current.requestId); form.append('teamId', teamId); form.append('checkpointId', checkpointId); form.append('nodeId', node.id)
        if (current.location) form.append('location', JSON.stringify(current.location))
        const result = await playerRequest<{ media: { id: string } }>('/api/v2/media', { method: 'POST', body: form })
        current = { ...current, mediaId: result.media.id }; await remember(current)
      }
      const result = await send({ type: 'submit_photo', checkpointId, nodeId: node.id, mediaId: current.mediaId! })
      if (result) { await photoRecord(key, null).catch(() => undefined); setPhoto(null); setMessage('Photo sent. Your organizer will review it.') }
      else setMessage('Your photo is uploaded. Use Retry last action to confirm it was submitted.')
    } catch (reason) {
      if (reason instanceof PlayerRequestError) {
        setMessage(reason.message)
        if (!current.mediaId && reason.status >= 400 && reason.status < 500 && ![408, 429].includes(reason.status)) {
          // An explicit rejection permits a fresh location and a new request.
          current = { ...current, requestId: newRequestId(), location: undefined }
          await remember(current)
        }
      } else {
        const locationError = reason instanceof Error && reason.message.startsWith('Location ')
        setMessage(locationError ? reason.message : 'The upload was interrupted. Retry with the same photo when your connection returns.')
      }
    } finally { if (mounted.current) setBusy(false) }
  }
  if (node.photoStatus === 'pending') return <p role="status" className="rounded-xl bg-amber-50 p-4 leading-relaxed">Your photo is waiting for organizer review. Keep this page open or return later; your team will continue when it is approved.</p>
  return <div className="space-y-3">
    {node.photoStatus === 'rejected' && <p role="alert" className="rounded-xl bg-amber-50 p-3">{node.reviewMessage || 'Please try another photo showing the whole landmark.'}</p>}
    <p className="text-sm text-stone-600">Take a clear photo showing the landmark. It will be resized before upload and checked by your organizer.{node.locationRequired ? ' This checkpoint also checks your approximate location.' : ''}</p>
    <label className="block text-sm font-semibold">Take or choose a photo<input type="file" accept="image/*" capture="environment" disabled={disabled || busy} onChange={event => void choose(event.target.files?.[0])} className="mt-2 block w-full text-sm file:mr-3 file:min-h-12 file:rounded-lg file:border-0 file:bg-stone-100 file:px-4 file:font-semibold" /></label>
    {preview && <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={preview} alt="Your photo ready for review" className="max-h-80 w-full rounded-xl object-contain" /></>}
    {photo && <button type="button" disabled={disabled || busy} onClick={() => void upload()} className="hunt-action min-h-12 w-full rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Sending…' : photo.mediaId ? 'Confirm photo submission' : 'Send photo for review'}</button>}
    {message && <p role="status" className="text-sm leading-relaxed text-stone-700">{message}</p>}
  </div>
}
