'use client'

import { useState } from 'react'
import type { MapPoint } from './maps/types'
import LeafletMapProvider from './maps/LeafletMapProvider'
import GoogleMapProvider from './maps/GoogleMapProvider'

export type { MapPoint }

export default function RegionMap({ points }: { points: MapPoint[] }) {
  const [googleFailed, setGoogleFailed] = useState(false)

  if (!points || points.length === 0) return null

  const configuredProvider = (process.env.NEXT_PUBLIC_MAP_PROVIDER || 'osm').toLowerCase()
  const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY || ''

  const useGoogle = configuredProvider === 'google' && googleApiKey && !googleFailed

  return (
    <div>
      {useGoogle ? (
        <GoogleMapProvider
          points={points}
          apiKey={googleApiKey}
          onError={() => setGoogleFailed(true)}
        />
      ) : (
        <LeafletMapProvider points={points} />
      )}
      <p className="mt-2 text-xs text-stone-600">
        Shaded areas are approximate. Map tiles need an internet connection.
      </p>
    </div>
  )
}
