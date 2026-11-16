import { useEffect } from 'react'
import { usePrinterStore } from '@/store/printer-store'
import { getAvailablePrintersFromQueues, getPrintersForServerType } from '@/data/printers'
import { checkActiveJobs, getAllPrintJobs, getQueueSnapshot, listPrintQueues } from '@/lib/printer-api'

let refreshInFlight: Promise<void> | undefined

export function refreshPrinters(): Promise<void> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = refresh().finally(() => { refreshInFlight = undefined })
  return refreshInFlight
}

async function refresh() {
  const store = usePrinterStore.getState()
  const config = store.sshConfig
  if (store.connectionStatus.type !== 'connected' || !config) return
  const current = () => {
    const latest = usePrinterStore.getState()
    return latest.connectionStatus.type === 'connected' && latest.sshConfig === config
  }
  store.setIsRefreshing(true)
  try {
    await checkActiveJobs(config)
    const jobs = await getAllPrintJobs()
    if (!current()) return
    if (jobs.success && jobs.data) store.setPrintJobs(jobs.data)
    const serverType = config.host.toLowerCase() === 'stf.comp.nus.edu.sg' ? 'stf' : 'stu'
    const queues = await listPrintQueues(config)
    if (!current()) return
    if (queues.success && queues.data) store.setPrinters(getAvailablePrintersFromQueues(queues.data, serverType))
    for (const printer of usePrinterStore.getState().printers) {
      if (!current()) return
      const response = await getQueueSnapshot(printer.queue_name)
      if (!current()) return
      store.updatePrinterStatus(printer.id, response.data?.status || 'Unknown', response.success ? response.data?.jobs.length : undefined)
    }
    store.setLastRefreshTime(new Date())
  } finally { store.setIsRefreshing(false) }
}

export function useBackgroundMonitor() {
  const config = usePrinterStore(state => state.sshConfig)
  const connected = usePrinterStore(state => state.connectionStatus.type === 'connected')
  useEffect(() => {
    if (!connected || !config) return
    const store = usePrinterStore.getState()
    if (!store.printers.length) store.setPrinters(getPrintersForServerType(config.host.includes('stf') ? 'stf' : 'stu'))
    let disposed = false
    let polling = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      if (disposed || polling) return
      polling = true
      try { if (document.visibilityState !== 'hidden') await refreshPrinters() }
      catch (error) { console.error('Queue refresh failed:', error) }
      polling = false
      if (!disposed) timer = setTimeout(poll, 15000)
    }
    const visible = () => { if (document.visibilityState !== 'hidden') { clearTimeout(timer); void poll() } }
    void poll()
    document.addEventListener('visibilitychange', visible)
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [connected, config])
}
