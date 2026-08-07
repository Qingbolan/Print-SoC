import { useState, useCallback } from 'react'
import { usePrinterStore } from '@/store/printer-store'
import { connectSSH, disconnectSSH } from '@/lib/printer-api'
import type { SSHConfig } from '@/types/printer'

export function useSSHConnection() {
  const { setConnectionStatus, setConnectedSession, clearConnectionSession } = usePrinterStore()
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
        setConnectedSession(config)
        setIsConnecting(false)
        return { success: true, message: result.data || 'Connected successfully' }
      }

      // Connection failed
      const errorMessage = result.error || 'Connection failed'
      clearConnectionSession()
      setConnectionStatus({
        type: 'error',
        message: errorMessage,
        lastAttempt: new Date(),
      })
      setIsConnecting(false)
      return { success: false, error: errorMessage }

    } catch (error) {
      clearInterval(timerInterval)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      clearConnectionSession()
      setConnectionStatus({
        type: 'error',
        message: errorMessage,
        lastAttempt: new Date(),
      })
      setIsConnecting(false)
      return { success: false, error: errorMessage }
    }
  }, [setConnectionStatus, setConnectedSession, clearConnectionSession])

  const disconnect = useCallback(async () => {
    try {
      await disconnectSSH()
      clearConnectionSession()
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to disconnect'
      return { success: false, error: errorMessage }
    }
  }, [clearConnectionSession])

  return {
    connect,
    disconnect,
    isConnecting,
  }
}
