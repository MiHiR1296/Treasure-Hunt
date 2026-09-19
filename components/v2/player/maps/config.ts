export interface MapProviderConfig {
  provider: 'google' | 'osm'
  googleApiKey?: string
}

/**
 * Resolves map provider configuration from environment flags.
 * Provider selection is case-insensitive.
 * Google Maps requires both provider='google' and a non-empty API key.
 */
export function getMapProviderConfig(
  providerEnv?: string,
  keyEnv?: string
): MapProviderConfig {
  const provider = (providerEnv || 'osm').trim().toLowerCase()
  const key = (keyEnv || '').trim()

  if (provider === 'google' && key) {
    return { provider: 'google', googleApiKey: key }
  }

  return { provider: 'osm' }
}
