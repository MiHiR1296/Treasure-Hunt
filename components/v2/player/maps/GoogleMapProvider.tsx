'use client'

import { useEffect, useRef, useState } from 'react'
import type { MapProviderProps } from './types'
import {
  loadGoogleMapsScript,
  type GoogleCircleInstance,
  type GoogleInfoWindowInstance,
  type GoogleMapInstance,
} from './googleTypes'

export interface GoogleMapProviderProps extends MapProviderProps {
  apiKey: string
  onError?: (error: Error) => void
}

export default function GoogleMapProvider({ points, apiKey, onError }: GoogleMapProviderProps) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<GoogleMapInstance | null>(null)
  const circlesRef = useRef<GoogleCircleInstance[]>([])
  const infoWindowsRef = useRef<GoogleInfoWindowInstance[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const hasPoints = points.length > 0

  const coordinates = JSON.stringify(
    points.map(point => [point.latitude, point.longitude]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  )
  const content = JSON.stringify(
    points.map(point => [point.latitude, point.longitude, point.radiusMeters, point.title || ''])
  )

  useEffect(() => {
    let isSubscribed = true

    if (!apiKey) {
      const err = new Error('Google Maps API key is missing')
      setLoadError(err.message)
      onError?.(err)
      return
    }

    loadGoogleMapsScript(apiKey)
      .then(() => {
        if (isSubscribed) {
          setLoaded(true)
        }
      })
      .catch((err: unknown) => {
        if (isSubscribed) {
          const error = err instanceof Error ? err : new Error('Failed to load Google Maps SDK')
          setLoadError(error.message)
          onError?.(error)
        }
      })

    return () => {
      isSubscribed = false
    }
  }, [apiKey, onError])

  useEffect(() => {
    if (!loaded || !hasPoints || !container.current || !window.google?.maps) return

    const mapsApi = window.google.maps
    const defaultCenter = points[0]
      ? { lat: points[0].latitude, lng: points[0].longitude }
      : { lat: 0, lng: 0 }

    const mapInstance = new mapsApi.Map(container.current, {
      center: defaultCenter,
      zoom: 15,
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: 'cooperative',
    })

    mapRef.current = mapInstance

    return () => {
      infoWindowsRef.current.forEach(iw => {
        iw.close()
        iw.setMap(null)
      })
      infoWindowsRef.current = []
      circlesRef.current.forEach(c => c.setMap(null))
      circlesRef.current = []
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, hasPoints])

  useEffect(() => {
    const mapInstance = mapRef.current
    if (!loaded || !mapInstance || !window.google?.maps) return

    const positions = JSON.parse(coordinates) as [number, number][]
    const mapsApi = window.google.maps

    if (positions.length > 1) {
      const bounds = new mapsApi.LatLngBounds()
      for (const [lat, lng] of positions) {
        bounds.extend({ lat, lng })
      }
      mapInstance.fitBounds(bounds, { top: 25, right: 25, bottom: 25, left: 25 })
    } else if (positions.length === 1) {
      mapInstance.setCenter({ lat: positions[0][0], lng: positions[0][1] })
    }
  }, [loaded, coordinates])

  useEffect(() => {
    const mapInstance = mapRef.current
    if (!loaded || !mapInstance || !window.google?.maps) return

    infoWindowsRef.current.forEach(iw => {
      iw.close()
      iw.setMap(null)
    })
    infoWindowsRef.current = []
    circlesRef.current.forEach(c => c.setMap(null))
    circlesRef.current = []

    const mapsApi = window.google.maps
    const locations = JSON.parse(content) as [number, number, number, string][]

    const createdCircles: GoogleCircleInstance[] = []
    const createdInfoWindows: GoogleInfoWindowInstance[] = []

    for (const [latitude, longitude, radiusMeters, title] of locations) {
      const circleInstance = new mapsApi.Circle({
        map: mapInstance,
        center: { lat: latitude, lng: longitude },
        radius: radiusMeters,
        fillColor: '#047857',
        fillOpacity: 0.25,
        strokeColor: '#047857',
        strokeWeight: 2,
      })

      const containerEl = document.createElement('div')
      containerEl.style.fontSize = '12px'
      containerEl.style.fontWeight = '600'
      containerEl.style.color = '#1c1917'
      containerEl.style.padding = '2px'
      containerEl.textContent = title || `Search within about ${radiusMeters} metres`

      const infoWindow = new mapsApi.InfoWindow({
        content: containerEl,
        position: { lat: latitude, lng: longitude },
      })

      infoWindow.open({ map: mapInstance })

      createdCircles.push(circleInstance)
      createdInfoWindows.push(infoWindow)
    }

    circlesRef.current = createdCircles
    infoWindowsRef.current = createdInfoWindows
  }, [loaded, content])

  if (!hasPoints) return null

  if (loadError) {
    return null
  }

  return (
    <div
      className="google-map-container h-72 overflow-hidden rounded-xl border border-stone-300"
      role="region"
      aria-label="Approximate search areas"
    >
      <div ref={container} style={{ height: '100%', width: '100%' }} />
    </div>
  )
}
