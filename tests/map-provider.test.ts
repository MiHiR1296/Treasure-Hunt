import test from 'node:test'
import assert from 'node:assert/strict'
import type { MapPoint } from '../components/v2/player/maps/types'
import { getMapProviderConfig } from '../components/v2/player/maps/config'

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

test('provider selection fallback handling works when SDK loading fails or key is absent', () => {
  // Missing key resolves to OSM provider
  const missingKeyConfig = getMapProviderConfig('google', '')
  assert.equal(missingKeyConfig.provider, 'osm')

  // Simulated fallback helper when Google SDK fails to load at runtime
  const simulateRuntimeSelection = (
    providerEnv?: string,
    keyEnv?: string,
    sdkLoadFailed = false
  ) => {
    const config = getMapProviderConfig(providerEnv, keyEnv)
    if (config.provider === 'google' && (!config.googleApiKey || sdkLoadFailed)) {
      return 'osm'
    }
    return config.provider
  }

  assert.equal(simulateRuntimeSelection('google', 'key-123', false), 'google')
  assert.equal(simulateRuntimeSelection('google', 'key-123', true), 'osm')
  assert.equal(simulateRuntimeSelection('google', '', false), 'osm')
})
