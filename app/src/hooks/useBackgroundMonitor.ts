import { useEffect } from 'react'
import { usePrinterStore } from '@/store/printer-store'
import { getAvailablePrintersFromQueues, getPrintersForServerType } from '@/data/printers'
import { checkActiveJobs, getAllPrintJobs, listPrintQueues } from '@/lib/printer-api'

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
    const serverType = config.host.toLowerCase() === 'stf.comp.nus.edu.sg' ? 'stf' : 'stu'
    const queues = await listPrintQueues(config)
    if (!current()) return
    if (queues.success && queues.data) store.setPrinters(getAvailablePrintersFromQueues(queues.data, serverType))
    store.setLastRefreshTime(new Date())
  } finally { store.setIsRefreshing(false) }
}

export function useBackgroundMonitor() {
  // Local system jobs exist even while the GUI is disconnected from SSH.
  useEffect(() => {
    let disposed = false
    let busy = false
    const refreshLocal = async () => {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      try {
        const response = await getAllPrintJobs()
        if (!disposed && response.success && response.data) usePrinterStore.getState().setPrintJobs(response.data)
      } catch (error) { console.error('Local job refresh failed:', error) }
      finally { busy = false }
    }
    void refreshLocal()
    const timer = setInterval(() => void refreshLocal(), 2000)
    document.addEventListener('visibilitychange', refreshLocal)
    return () => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', refreshLocal) }
  }, [])
  const config = usePrinterStore(state => state.sshConfig)
  const connected = usePrinterStore(state => state.connectionStatus.type === 'connected')
  useEffect(() => {
    if (!connected || !config) return
    let disposed = false
    let running = false
    let timer: ReturnType<typeof setTimeout>
    let delay = 3000
    async function pollActive() {
      if (disposed || running) return
      clearTimeout(timer)
      running = true
      const started = Date.now()
      try {
        const jobs = usePrinterStore.getState().printJobs
        if (jobs.some(job => ['Queued', 'Printing'].includes(job.status))) {
          const result = await checkActiveJobs(config!)
          if (!result.success) throw new Error(result.error || 'Queue tracking unavailable')
          const fresh = await getAllPrintJobs()
          if (!disposed && fresh.success && fresh.data && usePrinterStore.getState().sshConfig === config) usePrinterStore.getState().setPrintJobs(fresh.data)
        }
        delay = 3000
      } catch (error) {
        console.error('Job tracking failed:', error)
        delay = Math.min(delay * 2, 15000)
      } finally {
        running = false
        if (!disposed) timer = setTimeout(pollActive, Math.max(250, delay - (Date.now() - started)))
      }
    }
    const visible = () => { if (document.visibilityState !== 'hidden') void pollActive() }
    void pollActive()
    document.addEventListener('visibilitychange', visible)
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [connected, config])
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
      if (!disposed) timer = setTimeout(poll, 60000)
    }
    const visible = () => { if (document.visibilityState !== 'hidden') { clearTimeout(timer); void poll() } }
    void poll()
    document.addEventListener('visibilitychange', visible)
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [connected, config])
}
