import { useCallback, useEffect, useRef } from 'react'
import { usePrinterStore } from '@/store/printer-store'
import { getAvailablePrintersFromQueues, getPrintersForServerType } from '@/data/printers'
import { checkPrinterQueue, checkActiveJobs, getAllPrintJobs, listPrintQueues } from '@/lib/printer-api'

// Global refs to manage refresh state across all instances
const globalIsLoadingRef = { current: false }
const globalShouldContinueRef = { current: true }
const PRINTER_REFRESH_INTERVAL_MS = 30000
const ACTIVE_JOB_REFRESH_INTERVAL_MS = 5000
const ACTIVE_JOB_STATUSES = new Set(['Pending', 'Uploading', 'Queued', 'Printing'])

/**
 * Background monitor hook that automatically queries printer data when logged in
 * This runs in the background and updates the store
 */
export function useBackgroundMonitor() {
  const {
    sshConfig,
    connectionStatus,
    savedCredentials,
    printJobs,
    printers,
    setPrinters,
    setPrintJobs,
    updatePrinterStatus,
    setIsRefreshing,
    setLastRefreshTime
  } = usePrinterStore()
  const hasInitializedRef = useRef(false)
  const printersInitializedRef = useRef(false)
  const isConnected = connectionStatus.type === 'connected'
  const serverType = savedCredentials?.serverType || (sshConfig?.host?.includes('stf') ? 'stf' : 'stu')
  const hasActivePrintJobs = printJobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status))

  const refreshActiveJobs = useCallback(async () => {
    if (!isConnected || !sshConfig) return

    try {
      const result = await checkActiveJobs(sshConfig)
      if (result.success && result.data && result.data.length > 0) {
        const jobsResult = await getAllPrintJobs()
        if (jobsResult.success && jobsResult.data) {
          setPrintJobs(jobsResult.data)
        }
      }
    } catch (error) {
      console.error('Failed to check active jobs:', error)
    }
  }, [isConnected, sshConfig, setPrintJobs])

  const runActiveJobPoll = useCallback(async () => {
    if (!isConnected || !sshConfig || globalIsLoadingRef.current) return

    globalIsLoadingRef.current = true
    try {
      await refreshActiveJobs()
    } finally {
      globalIsLoadingRef.current = false
    }
  }, [isConnected, refreshActiveJobs, sshConfig])

  const loadAllQueues = useCallback(async () => {
    if (!isConnected || !sshConfig || globalIsLoadingRef.current) return

    globalIsLoadingRef.current = true
    setIsRefreshing(true)

    try {
      await refreshActiveJobs()

      let printersToCheck = usePrinterStore.getState().printers

      try {
        const queuesResult = await listPrintQueues(sshConfig)
        if (queuesResult.success && queuesResult.data) {
          const availablePrinters = getAvailablePrintersFromQueues(queuesResult.data, serverType)
          if (availablePrinters.length > 0) {
            setPrinters(availablePrinters)
            printersToCheck = availablePrinters
          }
        }
      } catch (error) {
        console.error('Failed to list print queues:', error)
      }

      // Fetch queue data for discovered printers sequentially to avoid overwhelming the persistent SSH connection
      // Can be interrupted if component unmounts or connection is lost
      for (const printer of printersToCheck) {
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
  }, [
    isConnected,
    refreshActiveJobs,
    serverType,
    setIsRefreshing,
    setLastRefreshTime,
    setPrinters,
    sshConfig,
    updatePrinterStatus,
  ])

  useEffect(() => {
    // Initialize printers in store only once
    if (!printersInitializedRef.current && printers.length === 0) {
      printersInitializedRef.current = true
      setPrinters(getPrintersForServerType(serverType))
    }
  }, [printers, setPrinters, serverType])

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

    // Set up printer/queue overview refresh every 30 seconds.
    const interval = setInterval(() => {
      if (!globalIsLoadingRef.current) {
        loadAllQueues()
      }
    }, PRINTER_REFRESH_INTERVAL_MS)

    return () => {
      clearInterval(interval)
      globalShouldContinueRef.current = false
      globalIsLoadingRef.current = false
    }
  }, [isConnected, loadAllQueues, sshConfig])

  useEffect(() => {
    if (!isConnected || !sshConfig || !hasActivePrintJobs) return

    const interval = setInterval(runActiveJobPoll, ACTIVE_JOB_REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [hasActivePrintJobs, isConnected, runActiveJobPoll, sshConfig])
}

/**
 * Manually trigger a printer refresh from any component
 * This is a global function that can be called from anywhere
 */
export async function refreshPrinters() {
  const store = usePrinterStore.getState()
  const {
    sshConfig,
    connectionStatus,
    savedCredentials,
    updatePrinterStatus,
    setPrintJobs,
    setPrinters,
    setIsRefreshing,
    setLastRefreshTime,
  } = store

  if (connectionStatus.type !== 'connected' || !sshConfig || globalIsLoadingRef.current) return
  const serverType = savedCredentials?.serverType || (sshConfig.host?.includes('stf') ? 'stf' : 'stu')

  globalIsLoadingRef.current = true
  setIsRefreshing(true)

  try {
    // Check active print jobs first and update their status
    try {
      const result = await checkActiveJobs(sshConfig)
      if (result.success && result.data && result.data.length > 0) {
        // Refresh job list if any jobs completed
        const jobsResult = await getAllPrintJobs()
        if (jobsResult.success && jobsResult.data) {
          setPrintJobs(jobsResult.data)
        }
      }
    } catch (error) {
      console.error('Failed to check active jobs:', error)
    }

    let printersToCheck = usePrinterStore.getState().printers

    try {
      const queuesResult = await listPrintQueues(sshConfig)
      if (queuesResult.success && queuesResult.data) {
        const availablePrinters = getAvailablePrintersFromQueues(queuesResult.data, serverType)
        if (availablePrinters.length > 0) {
          setPrinters(availablePrinters)
          printersToCheck = availablePrinters
        }
      }
    } catch (error) {
      console.error('Failed to list print queues:', error)
    }

    for (const printer of printersToCheck) {
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
