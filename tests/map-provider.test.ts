import test from 'node:test'
import assert from 'node:assert/strict'
import type { MapPoint } from '../components/v2/player/maps/types'

test('MapPoint interface handles single and multiple coordinates with optional titles', () => {
  const singlePoint: MapPoint[] = [{ latitude: 19.24, longitude: 73.13, radiusMeters: 50, title: 'Gate' }]
  const multiPoints: MapPoint[] = [
    { latitude: 19.24, longitude: 73.13, radiusMeters: 50, title: 'Point A' },
    { latitude: 19.26, longitude: 73.15, radiusMeters: 60, title: 'Point B' },
  ]

  assert.equal(singlePoint.length, 1)
  assert.equal(singlePoint[0].title, 'Gate')
  assert.equal(multiPoints.length, 2)
  assert.equal(multiPoints[1].radiusMeters, 60)
})

test('Map provider environment selection defaults to OpenStreetMap/Leaflet', () => {
  const defaultProvider = process.env.NEXT_PUBLIC_MAP_PROVIDER || 'osm'
  assert.equal(defaultProvider.toLowerCase(), 'osm')
})

test('Google Maps provider selection requires both provider flag and API key', () => {
  const isGoogleConfigured = (provider?: string, key?: string) => {
    return (provider || 'osm').toLowerCase() === 'google' && Boolean(key)
  }

  assert.equal(isGoogleConfigured('osm', 'some-key'), false)
  assert.equal(isGoogleConfigured('google', ''), false)
  assert.equal(isGoogleConfigured('google', undefined), false)
  assert.equal(isGoogleConfigured('google', 'valid-api-key'), true)
  assert.equal(isGoogleConfigured('GOOGLE', 'valid-api-key'), true)
})
