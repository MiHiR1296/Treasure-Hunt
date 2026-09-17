/* eslint-disable @next/next/no-img-element -- Organizer and device image assets use their original access-controlled URLs. */
'use client'

import { useEffect, useRef, useState } from 'react'
import { cameraErrorMessage } from '@/lib/utils/qrScanSession'

export default function CameraGuide({ description, referenceImageUrl, latitude, longitude }: { description: string; referenceImageUrl?: string; latitude?: number; longitude?: number }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const mounted = useRef(true)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [opacity, setOpacity] = useState(45)
  const [heading, setHeading] = useState<number | null>(null)
  const [navigation, setNavigation] = useState<{ distance: number; bearing: number; accuracy: number } | null>(null)
  const [orientationEnabled, setOrientationEnabled] = useState(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; stream.current?.getTracks().forEach(track => track.stop()) }
  }, [])
  useEffect(() => {
    if (!orientationEnabled) return
    const orient = (event: DeviceOrientationEvent) => {
      const safariHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
      if (typeof safariHeading === 'number') setHeading(safariHeading)
      else if (event.absolute && typeof event.alpha === 'number') setHeading((360 - event.alpha) % 360)
    }
    window.addEventListener('deviceorientation', orient)
    return () => window.removeEventListener('deviceorientation', orient)
  }, [orientationEnabled])
  const close = () => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; setOpen(false); setOrientationEnabled(false); setHeading(null) }
  const start = async () => {
    if (busy || open) return
    setBusy(true); setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable')
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      if (!mounted.current) { next.getTracks().forEach(track => track.stop()); return }
      stream.current = next; setOpen(true)
      if (video.current) { video.current.srcObject = next; await video.current.play() }
    } catch (reason) {
      stream.current?.getTracks().forEach(track => track.stop())
      stream.current = null
      if (video.current) video.current.srcObject = null
      if (mounted.current) { setOpen(false); setError(cameraErrorMessage(reason)) }
    }
    finally { if (mounted.current) setBusy(false) }
  }
  const locate = async () => {
    if (latitude === undefined || longitude === undefined) return
    setError('')
    const orientation = typeof DeviceOrientationEvent === 'undefined' ? undefined : DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> }
    try { if (!orientation?.requestPermission || await orientation.requestPermission() === 'granted') setOrientationEnabled(true) } catch { /* Distance remains available without orientation. */ }
    if (!navigator.geolocation) { setError('Location guidance is unavailable on this browser. Use the reference and ask your organizer if needed.'); return }
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (!mounted.current) return
      const rad = (n: number) => n * Math.PI / 180
      const dLat = rad(latitude - coords.latitude), dLng = rad(longitude - coords.longitude)
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(coords.latitude)) * Math.cos(rad(latitude)) * Math.sin(dLng / 2) ** 2
      const bearing = (Math.atan2(Math.sin(dLng) * Math.cos(rad(latitude)), Math.cos(rad(coords.latitude)) * Math.sin(rad(latitude)) - Math.sin(rad(coords.latitude)) * Math.cos(rad(latitude)) * Math.cos(dLng)) * 180 / Math.PI + 360) % 360
      setNavigation({ distance: 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))), bearing, accuracy: coords.accuracy })
    }, () => { if (mounted.current) setError('Location permission or a reliable reading is unavailable. The reference image can still guide you.') }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  }
  return <div className="space-y-3">
    <p className="leading-relaxed">{description}</p>
    <div className={`relative overflow-hidden rounded-xl bg-stone-950 ${open ? 'block' : 'hidden'}`}>
      <video ref={video} muted playsInline className="max-h-[30rem] min-h-64 w-full object-cover" />
      {referenceImageUrl && <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={referenceImageUrl} alt="Landmark reference overlay" className="pointer-events-none absolute inset-0 h-full w-full object-contain" style={{ opacity: opacity / 100 }} /></>}
      <div className="pointer-events-none absolute inset-[15%] rounded-lg border-2 border-white/70" aria-hidden="true" />
    </div>
    {!open && referenceImageUrl && <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={referenceImageUrl} alt="Landmark reference" className="max-h-80 w-full rounded-xl object-contain" /></>}
    {open && referenceImageUrl && <label className="block text-sm">Reference visibility<input type="range" min={0} max={90} value={opacity} onChange={event => setOpacity(Number(event.target.value))} className="mt-2 w-full" /></label>}
    <button type="button" disabled={busy} onClick={() => open ? close() : void start()} className="hunt-action min-h-12 w-full rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white">{busy ? 'Opening camera…' : open ? 'Close camera' : 'Open camera guide'}</button>
    {latitude !== undefined && longitude !== undefined && <button type="button" onClick={() => void locate()} className="hunt-action min-h-12 w-full rounded-xl border border-emerald-800 px-4 py-3 font-semibold text-emerald-900">Check distance and direction</button>}
    {navigation && <p role="status" className="text-sm"><span aria-hidden="true" style={{ display: 'inline-block', transform: `rotate(${navigation.bearing - (heading ?? 0)}deg)` }}>↑</span> About {Math.round(navigation.distance)} metres away · {Math.round(navigation.bearing)}° from north{heading === null ? ' (compass unavailable)' : ''}. Location accuracy ±{Math.round(navigation.accuracy)} m.</p>}
    <p className="text-xs leading-relaxed text-stone-600">Match the reference by eye. Camera guidance does not automatically verify the landmark. Stay aware of your surroundings.</p>
    {error && <p role="alert" className="text-sm text-amber-900">{error}</p>}
  </div>
}
