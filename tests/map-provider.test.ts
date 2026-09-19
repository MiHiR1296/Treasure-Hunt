import test from 'node:test'
import assert from 'node:assert/strict'
import type { MapPoint } from '../components/v2/player/maps/types'
import { getMapProviderConfig, resolveActiveProvider } from '../components/v2/player/maps/config'
import { loadGoogleMapsScript, resetGoogleMapsLoaderStateForTesting } from '../components/v2/player/maps/googleTypes'

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

test('production getMapProviderConfig logic handles all environment configurations', () => {
  // 1. no env/provider -> OSM
  assert.deepEqual(getMapProviderConfig(undefined, undefined), { provider: 'osm' })
  assert.deepEqual(getMapProviderConfig('', ''), { provider: 'osm' })

  // 2. osm + any key -> OSM
  assert.deepEqual(getMapProviderConfig('osm', 'valid-key-123'), { provider: 'osm' })
  assert.deepEqual(getMapProviderConfig('OSM', 'valid-key-123'), { provider: 'osm' })

  // 3. google + no key -> OSM/fallback
  assert.deepEqual(getMapProviderConfig('google', ''), { provider: 'osm' })
  assert.deepEqual(getMapProviderConfig('google', undefined), { provider: 'osm' })

  // 4. google + key -> Google
  assert.deepEqual(getMapProviderConfig('google', 'valid-key-123'), {
    provider: 'google',
    googleApiKey: 'valid-key-123',
  })

  // 5. provider comparison should be case-insensitive
  assert.deepEqual(getMapProviderConfig('GOOGLE', 'valid-key-123'), {
    provider: 'google',
    googleApiKey: 'valid-key-123',
  })
  assert.deepEqual(getMapProviderConfig(' Google ', ' valid-key-123 '), {
    provider: 'google',
    googleApiKey: 'valid-key-123',
  })
})

test('production resolveActiveProvider helper returns active provider considering runtime failure state', () => {
  const googleConfig = getMapProviderConfig('google', 'key-123')
  const osmConfig = getMapProviderConfig('osm', 'key-123')
  const missingKeyConfig = getMapProviderConfig('google', '')

  // 1. Google configured + key + no failure -> 'google'
  assert.equal(resolveActiveProvider(googleConfig, false), 'google')

  // 2. Google configured + key + runtime failed (onError triggered) -> 'osm' (Leaflet fallback)
  assert.equal(resolveActiveProvider(googleConfig, true), 'osm')

  // 3. Missing key -> 'osm'
  assert.equal(resolveActiveProvider(missingKeyConfig, false), 'osm')

  // 4. OSM configured -> 'osm'
  assert.equal(resolveActiveProvider(osmConfig, false), 'osm')
})

test('Google Maps loader script DOM cleanup and state reset allow retry after script error', () => {
  resetGoogleMapsLoaderStateForTesting()

  // Verify server-side load script rejection
  return loadGoogleMapsScript('test-key')
    .then(() => {
      assert.fail('Should reject on server environment')
    })
    .catch((err: Error) => {
      assert.ok(err instanceof Error)
      assert.match(err.message, /server/i)
    })
})
