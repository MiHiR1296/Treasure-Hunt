export interface GoogleMapOptions {
  center?: { lat: number; lng: number }
  zoom?: number
  disableDefaultUI?: boolean
  zoomControl?: boolean
  mapTypeControl?: boolean
  streetViewControl?: boolean
  fullscreenControl?: boolean
  gestureHandling?: string
}

export interface GoogleCircleOptions {
  map: unknown
  center: { lat: number; lng: number }
  radius: number
  fillColor?: string
  fillOpacity?: number
  strokeColor?: string
  strokeWeight?: number
}

export interface GoogleInfoWindowOptions {
  content: string | HTMLElement
  position?: { lat: number; lng: number }
}

export interface GoogleLatLngBounds {
  extend(point: { lat: number; lng: number }): GoogleLatLngBounds
}

export interface GoogleMapInstance {
  setCenter(latLng: { lat: number; lng: number }): void
  setZoom(zoom: number): void
  getZoom(): number
  fitBounds(
    bounds: GoogleLatLngBounds,
    padding?: number | { top?: number; right?: number; bottom?: number; left?: number }
  ): void
}

export interface GoogleCircleInstance {
  setMap(map: unknown | null): void
}

export interface GoogleInfoWindowInstance {
  open(options?: { map?: unknown }): void
  close(): void
}

export interface GoogleMapsAPI {
  Map: new (container: HTMLElement, options?: GoogleMapOptions) => GoogleMapInstance
  Circle: new (options?: GoogleCircleOptions) => GoogleCircleInstance
  InfoWindow: new (options?: GoogleInfoWindowOptions) => GoogleInfoWindowInstance
  LatLngBounds: new () => GoogleLatLngBounds
}

declare global {
  interface Window {
    google?: {
      maps?: GoogleMapsAPI
    }
  }
}

let loaderPromise: Promise<GoogleMapsAPI> | null = null

export function resetGoogleMapsLoaderStateForTesting() {
  loaderPromise = null
}

export function loadGoogleMapsScript(apiKey: string): Promise<GoogleMapsAPI> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps script cannot be loaded on the server'))
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps)
  }

  if (loaderPromise) {
    return loaderPromise
  }

  const scriptId = 'google-maps-js-sdk'
  const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null

  // If a failed or stale script tag exists in DOM without window.google.maps, remove it
  if (existingScript) {
    existingScript.remove()
  }

  loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = scriptId
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`
    script.async = true
    script.defer = true

    script.onload = () => {
      if (window.google?.maps) {
        resolve(window.google.maps)
      } else {
        loaderPromise = null
        script.remove()
        reject(new Error('Google Maps SDK loaded but window.google.maps is undefined'))
      }
    }

    script.onerror = (err) => {
      loaderPromise = null
      script.remove()
      reject(err)
    }

    document.head.appendChild(script)
  })

  return loaderPromise
}
