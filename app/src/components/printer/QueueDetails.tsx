import { useEffect, useState } from 'react'
import { getQueueSnapshot } from '@/lib/printer-api'
import type { QueueSnapshot } from '@/types/printer'
import { usePrinterStore } from '@/store/printer-store'
import { Button } from '@/components/ui/button'
import { RefreshCw, ChevronDown, FileText, Check } from 'lucide-react'
import { usePrintCopy, printerStatusLabel, formatBytes } from '@/lib/print-copy'
import { cn } from '@/lib/utils'

export function QueueDetails({ queue, active }: { queue: string; active: boolean }) {
  const { text, locale } = usePrintCopy()
  const username = usePrinterStore(state => state.sshConfig?.username)
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!active) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      setLoading(true)
      const response = await getQueueSnapshot(queue)
      if (disposed) return
      setLoading(false)
      if (response.success && response.data) {
        setSnapshot(response.data); setError('')
        const store = usePrinterStore.getState()
        const printer = store.printers.find(item => item.queue_name === queue)
        if (printer) store.updatePrinterStatus(printer.id, response.data.status, response.data.jobs.length)
      }
      else setError(response.error || 'Queue status unavailable')
      timer = setTimeout(refresh, 10000)
    }
    void refresh()
    return () => { disposed = true; clearTimeout(timer) }
  }, [queue, active, revision])
  const fault = snapshot && ['OutOfPaper', 'Offline', 'Error'].includes(snapshot.status)
  return <section aria-label={text.queue}>
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
      <h4 className="text-sm font-semibold">{text.queue}{snapshot && <span className="ml-2 font-normal tabular-nums text-muted-foreground">{snapshot.jobs.length}</span>}</h4>
      <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label={text.refresh} title={text.refresh} disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className={cn('size-3.5', loading && 'animate-spin motion-reduce:animate-none')} /></Button>
    </div>
    <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-xs">
      <span role="status" className={cn('flex items-center gap-2 text-muted-foreground', fault && 'text-destructive')}>
        <span className={cn('size-1.5 rounded-full bg-muted-foreground/50', fault && 'bg-destructive', snapshot?.status === 'Online' && 'bg-success', snapshot?.status === 'Busy' && 'bg-primary')} />
        {error ? text.unavailable : snapshot ? printerStatusLabel(snapshot.status, locale) : text.updating}
      </span>
      {snapshot && <span className="tabular-nums text-muted-foreground">{text.updated} {new Date(snapshot.checked_at).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-SG', { hour: '2-digit', minute: '2-digit' })}</span>}
    </div>
    {error && <p role="alert" className="pb-3 text-xs text-muted-foreground">{text.retryHint}</p>}
    {!snapshot && loading && <div className="space-y-3 py-4" aria-label={text.updating}><div className="h-3 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none" /><div className="h-3 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" /></div>}
    {snapshot && <>
      <ol className="divide-y divide-border/50">
        {snapshot.jobs.map(job => <li key={`${job.owner}-${job.job_id}`} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-3 py-4">
          <span className="flex size-8 items-center justify-center rounded-md bg-muted/60 text-xs tabular-nums text-muted-foreground" title={`${text.position}: ${job.rank}`}>{job.rank.toLowerCase() === 'active' ? <FileText className="size-4 text-primary" /> : job.rank.replace(/(st|nd|rd|th)$/, '')}</span>
          <div className="min-w-0"><p className="truncate text-sm font-medium" title={job.file}>{job.file}</p><p className="mt-1 truncate text-xs text-muted-foreground">{job.owner === username ? text.mine : job.owner} <span aria-hidden="true">·</span> #{job.job_id}{job.total_size && <> <span aria-hidden="true">·</span> {/^\d+ bytes$/.test(job.total_size) ? formatBytes(parseInt(job.total_size, 10)) : job.total_size}</>}</p></div>
          {job.rank.toLowerCase() === 'active' && <span className="pt-0.5 text-xs text-primary">{text.active}</span>}
        </li>)}
      </ol>
      {snapshot.jobs.length === 0 && <div className="flex items-start gap-3 py-6"><Check className="mt-0.5 size-4 text-muted-foreground" /><div><p className="text-sm font-medium">{snapshot.jobs_complete ? text.empty : text.unavailable}</p>{snapshot.jobs_complete && !fault && <p className="mt-1 text-xs text-muted-foreground">{text.emptyHint}</p>}</div></div>}
    </>}
    {(snapshot || error) && <details className="group pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{text.details}<ChevronDown className="size-3 transition-transform group-open:rotate-180" /></summary>
      <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-xs leading-5 text-muted-foreground">{error || snapshot?.raw_output || text.noResponse}</pre>
    </details>}
  </section>
}
