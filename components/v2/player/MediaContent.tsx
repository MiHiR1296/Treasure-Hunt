/* eslint-disable @next/next/no-img-element -- Organizer and device image assets use their original access-controlled URLs. */
'use client'

import dynamic from 'next/dynamic'
import type { DisplayContent } from '@/lib/engine/types'
const RegionMap = dynamic(() => import('./RegionMap'), { ssr: false, loading: () => <p>Opening the map…</p> })
const CameraGuide = dynamic(() => import('./CameraGuide'), { ssr: false })

export default function MediaContent({ content }: { content: DisplayContent }) {
  switch (content.type) {
    case 'text': return <p className="whitespace-pre-wrap leading-relaxed">{content.text}</p>
    case 'image': return <figure>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={content.url} alt={content.alt} loading="lazy" className="max-h-[32rem] w-full rounded-xl object-contain" /></figure>
    case 'map': return <div className="space-y-3"><RegionMap points={[content]} /><p className="text-sm">Search within about {content.radiusMeters} metres of {content.latitude}, {content.longitude}.</p><a href={`https://www.openstreetmap.org/?mlat=${content.latitude}&mlon=${content.longitude}#map=16/${content.latitude}/${content.longitude}`} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center font-semibold text-emerald-800 underline">Open location in map</a></div>
    case 'audio': case 'video': return <div className="space-y-3"><p className="font-semibold">{content.title}</p>{content.type === 'audio' ? <audio controls preload="none" src={content.url} className="w-full" aria-label={content.title} /> : <video controls playsInline preload="metadata" src={content.url} className="max-h-96 w-full rounded-xl" aria-label={content.title} />}{content.transcript && <details><summary className="min-h-12 cursor-pointer py-3 font-semibold">Read transcript</summary><p className="whitespace-pre-wrap leading-relaxed">{content.transcript}</p></details>}</div>
    case 'camera': return <CameraGuide description={content.description} referenceImageUrl={content.referenceImageUrl} latitude={content.latitude} longitude={content.longitude} />
  }
}
