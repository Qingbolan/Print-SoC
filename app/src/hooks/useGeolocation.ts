import { useState, useEffect, useCallback, useRef } from 'react'

export interface GeolocationPosition {
  lat: number
  lng: number
  accuracy: number
  timestamp: number
}

export interface GeolocationState {
  position: GeolocationPosition | null
  error: GeolocationError | null
  loading: boolean
  permissionDenied: boolean
  permissionState: 'granted' | 'denied' | 'prompt' | null
}

export interface GeolocationError {
  code: number
  message: string
}

interface UseGeolocationOptions {
  enableHighAccuracy?: boolean
  timeout?: number
  maximumAge?: number
}

const defaultOptions: UseGeolocationOptions = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 30000, // Cache for 30 seconds
}

export function useGeolocation(options: UseGeolocationOptions = {}) {
  const opts = { ...defaultOptions, ...options }
  const watchIdRef = useRef<number | null>(null)
  const tauriGeoRef = useRef<typeof import('@tauri-apps/plugin-geolocation') | null>(null)

  const [state, setState] = useState<GeolocationState>({
    position: null,
    error: null,
    loading: false,
    permissionDenied: false,
    permissionState: null,
  })

  // Check if Tauri geolocation is available
  const loadTauriGeolocation = useCallback(async () => {
    try {
      const geo = await import('@tauri-apps/plugin-geolocation')
      tauriGeoRef.current = geo
      return geo
    } catch (e) {
      console.warn('[Geolocation] Tauri plugin not available, falling back to browser API')
      return null
    }
  }, [])

  // Check permissions using Tauri plugin
  const checkPermissions = useCallback(async () => {
    const geo = await loadTauriGeolocation()
    if (geo) {
      try {
        const status = await geo.checkPermissions()
        console.log('[Geolocation] Tauri permission status:', status)
        const permState = status.location === 'granted' ? 'granted'
          : status.location === 'denied' ? 'denied'
          : 'prompt'
        setState(prev => ({ ...prev, permissionState: permState }))
        return permState
      } catch (e) {
        console.error('[Geolocation] Failed to check permissions:', e)
      }
    }
    // Fallback to browser API
    if ('permissions' in navigator) {
      try {
        const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
        setState(prev => ({ ...prev, permissionState: result.state }))
        return result.state
      } catch (e) {
        console.warn('[Geolocation] Browser permission check failed:', e)
      }
    }
    return null
  }, [loadTauriGeolocation])

  // Request permissions using Tauri plugin
  const requestPermissions = useCallback(async () => {
    const geo = await loadTauriGeolocation()
    if (geo) {
      try {
        const status = await geo.requestPermissions(['location'])
        console.log('[Geolocation] Requested permissions, status:', status)
        const permState = status.location === 'granted' ? 'granted'
          : status.location === 'denied' ? 'denied'
          : 'prompt'
        setState(prev => ({
          ...prev,
          permissionState: permState,
          permissionDenied: permState === 'denied'
        }))
        return permState === 'granted'
      } catch (e) {
        console.error('[Geolocation] Failed to request permissions:', e)
        return false
      }
    }
    return false
  }, [loadTauriGeolocation])

  // Validate GPS coordinates - (0, 0) is in the ocean and invalid for our use case
  const isValidPosition = (lat: number, lng: number): boolean => {
    // Check for null island (0, 0) or obviously invalid coordinates
    if (lat === 0 && lng === 0) return false
    // Check for valid latitude range (-90 to 90)
    if (lat < -90 || lat > 90) return false
    // Check for valid longitude range (-180 to 180)
    if (lng < -180 || lng > 180) return false
    return true
  }

  // Browser-based geolocation fallback
  const requestPositionFromBrowser = useCallback(() => {
    if (!navigator.geolocation) {
      console.error('[Geolocation] Browser API not supported')
      setState(prev => ({
        ...prev,
        error: {
          code: 0,
          message: 'Geolocation is not supported by this browser/device',
        },
        loading: false,
      }))
      return
    }

    console.log('[Geolocation] Using browser API to get position...')

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        console.log('[Geolocation] Browser position received:', pos.coords.latitude, pos.coords.longitude)

        // Validate browser coordinates too
        if (!isValidPosition(pos.coords.latitude, pos.coords.longitude)) {
          console.error('[Geolocation] Browser also returned invalid coordinates')
          setState(prev => ({
            ...prev,
            error: {
              code: 2,
              message: 'Unable to get valid location. Please check your location settings.',
            },
            loading: false,
          }))
          return
        }

        setState(prev => ({
          ...prev,
          position: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
          },
          error: null,
          loading: false,
          permissionDenied: false,
          permissionState: 'granted',
        }))

        // Start watching
        if (watchIdRef.current === null) {
          console.log('[Geolocation] Starting browser watch...')
          watchIdRef.current = navigator.geolocation.watchPosition(
            (watchPos) => {
              if (!isValidPosition(watchPos.coords.latitude, watchPos.coords.longitude)) {
                return // Ignore invalid watch updates
              }
              setState(prev => ({
                ...prev,
                position: {
                  lat: watchPos.coords.latitude,
                  lng: watchPos.coords.longitude,
                  accuracy: watchPos.coords.accuracy,
                  timestamp: watchPos.timestamp,
                },
                error: null,
              }))
            },
            (err) => {
              console.error('[Geolocation] Watch error:', err.code, err.message)
            },
            {
              enableHighAccuracy: opts.enableHighAccuracy,
              timeout: opts.timeout,
              maximumAge: opts.maximumAge,
            }
          )
        }
      },
      (err) => {
        console.error('[Geolocation] Browser error:', err.code, err.message)
        setState(prev => ({
          ...prev,
          error: {
            code: err.code,
            message: err.message,
          },
          loading: false,
          permissionDenied: err.code === 1, // PERMISSION_DENIED
          permissionState: err.code === 1 ? 'denied' : prev.permissionState,
        }))
      },
      {
        enableHighAccuracy: opts.enableHighAccuracy,
        timeout: opts.timeout,
        maximumAge: opts.maximumAge,
      }
    )
  }, [opts.enableHighAccuracy, opts.timeout, opts.maximumAge])

  // Get current position - tries Tauri first, then browser
  const requestPosition = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }))

    const geo = await loadTauriGeolocation()

    if (geo) {
      // Use Tauri geolocation plugin
      try {
        console.log('[Geolocation] Using Tauri plugin to get position...')

        // Directly try to get position - this will trigger permission dialog if needed
        const position = await geo.getCurrentPosition({
          enableHighAccuracy: opts.enableHighAccuracy ?? true,
          timeout: opts.timeout ?? 15000,
          maximumAge: opts.maximumAge ?? 30000,
        })

        console.log('[Geolocation] Tauri raw response:', JSON.stringify(position, null, 2))
        console.log('[Geolocation] Tauri position received:', position.coords.latitude, position.coords.longitude)

        // Validate coordinates
        if (!isValidPosition(position.coords.latitude, position.coords.longitude)) {
          console.warn('[Geolocation] Invalid coordinates received (0,0 or out of range), falling back to browser API')
          // Fall back to browser API
          return requestPositionFromBrowser()
        }

        setState(prev => ({
          ...prev,
          position: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          },
          error: null,
          loading: false,
          permissionDenied: false,
          permissionState: 'granted',
        }))

        // Start watching position with validation
        if (watchIdRef.current === null) {
          console.log('[Geolocation] Starting Tauri watch...')
          watchIdRef.current = await geo.watchPosition(
            {
              enableHighAccuracy: opts.enableHighAccuracy ?? true,
              timeout: opts.timeout ?? 15000,
              maximumAge: opts.maximumAge ?? 30000,
            },
            (pos) => {
              if (!pos) return
              // Validate watch updates
              if (!isValidPosition(pos.coords.latitude, pos.coords.longitude)) {
                console.warn('[Geolocation] Watch received invalid coordinates, ignoring')
                return
              }
              console.log('[Geolocation] Watch update:', pos.coords.latitude, pos.coords.longitude)
              setState(prev => ({
                ...prev,
                position: {
                  lat: pos.coords.latitude,
                  lng: pos.coords.longitude,
                  accuracy: pos.coords.accuracy,
                  timestamp: pos.timestamp,
                },
                error: null,
              }))
            }
          )
        }
      } catch (e) {
        console.error('[Geolocation] Tauri error:', e)
        const errorMsg = e instanceof Error ? e.message : String(e)
        const isPermissionError = errorMsg.toLowerCase().includes('permission') ||
          errorMsg.toLowerCase().includes('denied') ||
          errorMsg.toLowerCase().includes('not authorized')

        console.log('[Geolocation] Permission error?', isPermissionError)
        console.log('[Geolocation] Falling back to browser API...')

        // Try browser API as fallback
        return requestPositionFromBrowser()
      }
    } else {
      // Tauri plugin not available, use browser API
      requestPositionFromBrowser()
    }
  }, [loadTauriGeolocation, opts.enableHighAccuracy, opts.timeout, opts.maximumAge, requestPositionFromBrowser])

  // Check permission state on mount
  useEffect(() => {
    checkPermissions().then(permState => {
      if (permState === 'granted') {
        requestPosition()
      }
    })
  }, [])

  // Cleanup watch on unmount
  useEffect(() => {
    return () => {
      const cleanup = async () => {
        if (watchIdRef.current !== null) {
          console.log('[Geolocation] Stopping watch')
          const geo = tauriGeoRef.current
          if (geo) {
            try {
              await geo.clearWatch(watchIdRef.current)
            } catch (e) {
              console.warn('[Geolocation] Failed to clear Tauri watch:', e)
            }
          } else if (navigator.geolocation) {
            navigator.geolocation.clearWatch(watchIdRef.current)
          }
          watchIdRef.current = null
        }
      }
      cleanup()
    }
  }, [])

  return {
    ...state,
    requestPosition,
    requestPermissions,
    isSupported: true, // Tauri plugin or browser API
  }
}

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * Returns distance in meters
 */
export function calculateGpsDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000 // Earth's radius in meters
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180)
}

/**
 * Format distance for display
 */
export function formatGpsDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`
  }
  return `${(meters / 1000).toFixed(1)}km`
}
