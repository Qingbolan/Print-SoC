import { useEffect, useRef } from 'react'
import { usePrinterStore } from '@/store/printer-store'
import { PRINTERS } from '@/data/printers'
import { checkPrinterQueue } from '@/lib/printer-api'

// Global refs to manage refresh state across all instances
const globalIsLoadingRef = { current: false }
const globalShouldContinueRef = { current: true }

/**
 * Background monitor hook that automatically queries printer data when logged in
 * This runs in the background and updates the store
 */
export function useBackgroundMonitor() {
  const {
    sshConfig,
    isConnected,
    printers,
    setPrinters,
    updatePrinterStatus,
    setIsRefreshing,
    setLastRefreshTime
  } = usePrinterStore()
  const hasInitializedRef = useRef(false)
  const printersInitializedRef = useRef(false)

  useEffect(() => {
    // Initialize printers in store only once
    if (!printersInitializedRef.current && printers.length === 0) {
      printersInitializedRef.current = true
      setPrinters(PRINTERS)
    }
  }, [printers, setPrinters])

  useEffect(() => {
    globalShouldContinueRef.current = true

    if (!isConnected || !sshConfig) {
      hasInitializedRef.current = false
      globalIsLoadingRef.current = false
      return
    }

    // Load data immediately when connected (only once per connection)
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true

      // Delay initial load to avoid blocking login
      setTimeout(() => {
        loadAllQueues()
      }, 500)
    }

    // Set up auto-refresh every 30 seconds
    const interval = setInterval(() => {
      if (!globalIsLoadingRef.current) {
        loadAllQueues()
      }
    }, 30000)

    return () => {
      clearInterval(interval)
      globalShouldContinueRef.current = false
      globalIsLoadingRef.current = false
    }
  }, [isConnected, sshConfig])

  const loadAllQueues = async () => {
    if (!sshConfig || globalIsLoadingRef.current) return

    globalIsLoadingRef.current = true
    setIsRefreshing(true)

    try {
      // Fetch queue data for all printers sequentially to avoid overwhelming the persistent SSH connection
      // Can be interrupted if component unmounts or connection is lost
      for (const printer of PRINTERS) {
        // Check if we should continue
        if (!globalShouldContinueRef.current) {
          break
        }

        try {
          const result = await checkPrinterQueue(sshConfig, printer.queue_name)
          const queueCount = result.success ? (result.data?.length || 0) : 0
          const status = result.success ? 'Online' : 'Error'
          updatePrinterStatus(printer.id, status, queueCount)
        } catch (error) {
          console.error(`Failed to check queue for ${printer.name}:`, error)
          updatePrinterStatus(printer.id, 'Error', 0)
        }
      }

      setLastRefreshTime(new Date())
    } catch (error) {
      console.error('Failed to load printer queues:', error)
    } finally {
      globalIsLoadingRef.current = false
      setIsRefreshing(false)
    }
  }
}

/**
 * Manually trigger a printer refresh from any component
 * This is a global function that can be called from anywhere
 */
export async function refreshPrinters() {
  const store = usePrinterStore.getState()
  const { sshConfig, updatePrinterStatus, setIsRefreshing, setLastRefreshTime } = store

  if (!sshConfig || globalIsLoadingRef.current) return

  globalIsLoadingRef.current = true
  setIsRefreshing(true)

  try {
    for (const printer of PRINTERS) {
      if (!globalShouldContinueRef.current) {
        break
      }

      try {
        const result = await checkPrinterQueue(sshConfig, printer.queue_name)
        const queueCount = result.success ? (result.data?.length || 0) : 0
        const status = result.success ? 'Online' : 'Error'
        updatePrinterStatus(printer.id, status, queueCount)
      } catch (error) {
        console.error(`Failed to check queue for ${printer.name}:`, error)
        updatePrinterStatus(printer.id, 'Error', 0)
      }
    }

    setLastRefreshTime(new Date())
  } catch (error) {
    console.error('Failed to load printer queues:', error)
  } finally {
    globalIsLoadingRef.current = false
    setIsRefreshing(false)
  }
}
