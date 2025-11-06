import { useState, useCallback } from 'react'
import { usePrinterStore } from '@/store/printer-store'
import { testSSHConnection } from '@/lib/printer-api'
import type { SSHConfig } from '@/types/printer'

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000  // Increased from 1s to 2s to match backend

export function useSSHConnection() {
  const { setConnectionStatus, setIsConnected } = usePrinterStore()
  const [isConnecting, setIsConnecting] = useState(false)

  const connectWithRetry = useCallback(async (config: SSHConfig) => {
    setIsConnecting(true)
    let attempt = 0
    const startTime = Date.now()

    // Set initial connecting status
    setConnectionStatus({
      type: 'connecting',
      attempt: 1,
      maxAttempts: MAX_RETRIES,
      elapsedSeconds: 0,
    })

    // Update elapsed time every second
    const timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      setConnectionStatus({
        type: 'connecting',
        attempt: attempt + 1,
        maxAttempts: MAX_RETRIES,
        elapsedSeconds: elapsed,
      })
    }, 1000)

    try {
      for (attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          // Update attempt number
          setConnectionStatus({
            type: 'connecting',
            attempt: attempt + 1,
            maxAttempts: MAX_RETRIES,
            elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
          })

          // Try to connect
          const result = await testSSHConnection(config)

          if (result.success) {
            clearInterval(timerInterval)
            setConnectionStatus({
              type: 'connected',
              connectedAt: new Date(),
            })
            setIsConnected(true)
            setIsConnecting(false)
            return { success: true, message: result.data || 'Connected successfully' }
          }

          // If not success and not the last attempt, wait before retry
          if (attempt < MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
          }
        } catch (error) {
          // Continue to next retry
          if (attempt < MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
          }
        }
      }

      // All retries failed
      clearInterval(timerInterval)
      const errorMessage = 'Connection failed after ' + MAX_RETRIES + ' attempts'
      setConnectionStatus({
        type: 'error',
        message: errorMessage,
        lastAttempt: new Date(),
      })
      setIsConnected(false)
      setIsConnecting(false)
      return { success: false, error: errorMessage }

    } catch (error) {
      clearInterval(timerInterval)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setConnectionStatus({
        type: 'error',
        message: errorMessage,
        lastAttempt: new Date(),
      })
      setIsConnected(false)
      setIsConnecting(false)
      return { success: false, error: errorMessage }
    }
  }, [setConnectionStatus, setIsConnected])

  const disconnect = useCallback(() => {
    setConnectionStatus({ type: 'disconnected' })
    setIsConnected(false)
  }, [setConnectionStatus, setIsConnected])

  return {
    connectWithRetry,
    disconnect,
    isConnecting,
  }
}
