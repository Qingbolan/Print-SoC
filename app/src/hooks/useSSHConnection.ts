import { useState, useCallback } from 'react'
import { usePrinterStore } from '@/store/printer-store'
import { connectSSH, disconnectSSH } from '@/lib/printer-api'
import type { SSHConfig } from '@/types/printer'

export function useSSHConnection() {
  const { setConnectionStatus, setIsConnected } = usePrinterStore()
  const [isConnecting, setIsConnecting] = useState(false)

  const connect = useCallback(async (config: SSHConfig) => {
    setIsConnecting(true)
    const startTime = Date.now()

    // Set connecting status
    setConnectionStatus({
      type: 'connecting',
      elapsedSeconds: 0,
    })

    // Update elapsed time every second
    const timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      setConnectionStatus({
        type: 'connecting',
        elapsedSeconds: elapsed,
      })
    }, 1000)

    try {
      // Backend handles retries internally
      const result = await connectSSH(config)
      clearInterval(timerInterval)

      if (result.success) {
        setConnectionStatus({
          type: 'connected',
          connectedAt: new Date(),
        })
        setIsConnected(true)
        setIsConnecting(false)
        return { success: true, message: result.data || 'Connected successfully' }
      }

      // Connection failed
      const errorMessage = result.error || 'Connection failed'
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

  const disconnect = useCallback(async () => {
    try {
      await disconnectSSH()
      setConnectionStatus({ type: 'disconnected' })
      setIsConnected(false)
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to disconnect'
      return { success: false, error: errorMessage }
    }
  }, [setConnectionStatus, setIsConnected])

  return {
    connect,
    disconnect,
    isConnecting,
  }
}
