import { useEffect, useRef } from 'react'
import { usePrinterStore } from '@/store/printer-store'
import { PRINTERS } from '@/data/printers'
import { checkPrinterQueue } from '@/lib/printer-api'

/**
 * Background monitor hook that automatically queries printer data when logged in
 * This runs in the background and updates the store
 */
export function useBackgroundMonitor() {
  const { sshConfig, isConnected, printers, setPrinters, updatePrinterStatus } = usePrinterStore()
  const isLoadingRef = useRef(false)
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
    if (!isConnected || !sshConfig) {
      hasInitializedRef.current = false
      isLoadingRef.current = false
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
      if (!isLoadingRef.current) {
        loadAllQueues()
      }
    }, 30000)

    return () => {
      clearInterval(interval)
    }
  }, [isConnected, sshConfig])

  const loadAllQueues = async () => {
    if (!sshConfig || isLoadingRef.current) return

    isLoadingRef.current = true

    try {
      // Fetch queue data for all printers in parallel
      await Promise.all(
        PRINTERS.map(async (printer) => {
          try {
            const result = await checkPrinterQueue(sshConfig, printer.queue_name)
            const queueCount = result.success ? (result.data?.length || 0) : 0
            const status = result.success ? 'Online' : 'Error'
            updatePrinterStatus(printer.id, status, queueCount)
          } catch (error) {
            console.error(`Failed to check queue for ${printer.name}:`, error)
            updatePrinterStatus(printer.id, 'Error', 0)
          }
        })
      )
    } catch (error) {
      console.error('Failed to load printer queues:', error)
    } finally {
      isLoadingRef.current = false
    }
  }
}
