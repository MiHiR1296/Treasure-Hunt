'use client'

import { useEffect, useRef } from 'react'
import { circle, layerGroup, map as createMap, tileLayer, type LayerGroup, type Map as LeafletMap } from 'leaflet'
import type { MapLocation } from '@/lib/engine/types'
import 'leaflet/dist/leaflet.css'

export interface MapPoint extends MapLocation { title?: string }
export default function RegionMap({ points }: { points: MapPoint[] }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)
  const regions = useRef<LayerGroup | null>(null)
  const hasPoints = points.length > 0
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // Polls rebuild public point objects. Only changed coordinates should move a
  // viewport that the player has deliberately panned or zoomed.
  const coordinates = JSON.stringify(points.map(point => [point.latitude, point.longitude]).sort((a, b) => a[0] - b[0] || a[1] - b[1]))
  const content = JSON.stringify(points.map(point => [point.latitude, point.longitude, point.radiusMeters, point.title || '']))

  useEffect(() => {
    if (!hasPoints || !container.current) return
    // Matching initialization and disposal in one effect also handles React's
    // development mount/cleanup/remount cycle without reusing a live container.
    const instance = createMap(container.current, { zoom: 15, scrollWheelZoom: false, zoomAnimation: !reducedMotion, fadeAnimation: !reducedMotion, markerZoomAnimation: !reducedMotion, inertia: !reducedMotion })
    tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(instance)
    map.current = instance
    regions.current = layerGroup().addTo(instance)
    return () => { instance.remove(); map.current = null; regions.current = null }
  }, [hasPoints, reducedMotion])

  useEffect(() => {
    const instance = map.current
    if (!instance) return
    const positions = JSON.parse(coordinates) as [number, number][]
    if (positions.length > 1) instance.fitBounds(positions, { padding: [25, 25], maxZoom: 16, animate: false })
    else if (positions.length === 1) instance.setView(positions[0], instance.getZoom(), { animate: false })
  }, [coordinates, reducedMotion])

  useEffect(() => {
    const group = regions.current
    if (!group) return
    group.clearLayers()
    const locations = JSON.parse(content) as [number, number, number, string][]
    for (const [latitude, longitude, radiusMeters, title] of locations) {
      const label = document.createElement('span')
      label.textContent = title || `Search within about ${radiusMeters} metres`
      circle([latitude, longitude], { radius: radiusMeters, color: '#047857' }).bindTooltip(label).addTo(group)
    }
  }, [content, reducedMotion])

  if (!hasPoints) return null
  return <div>
    <div className="h-72 overflow-hidden rounded-xl border border-stone-300 [&_.leaflet-container_.leaflet-control-attribution]:bg-white" role="region" aria-label="Approximate search areas">
      <div ref={container} style={{ height: '100%', width: '100%', zIndex: 0 }} />
    </div>
    <p className="mt-2 text-xs text-stone-600">Shaded areas are approximate. Map tiles need an internet connection.</p>
  </div>
}
