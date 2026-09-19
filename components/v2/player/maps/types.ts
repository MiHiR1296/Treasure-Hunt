import type { MapLocation } from '@/lib/engine/types'

export interface MapPoint extends MapLocation {
  title?: string
}

export interface MapProviderProps {
  points: MapPoint[]
}
