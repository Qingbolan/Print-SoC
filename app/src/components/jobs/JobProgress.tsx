import { usePrinterStore } from '@/store/printer-store'
import { useEffect, useState } from 'react'
import { getPrintJob, cancelPrintJob, resolveSubmission, linkJobAccount } from '@/lib/printer-api'
import { jobStatusLabel, uploadPercent, queuePositionLabel } from '@/lib/job-progress'
import type { PrintJob, SSHConfig } from '@/types/printer'
import { Button } from '@/components/ui/button'
import { usePrintCopy, formatBytes } from '@/lib/print-copy'

export function JobProgress({ jobId, initialJob, config }: { jobId: string; initialJob?: PrintJob; config?: SSHConfig | null }) {
  const { text, locale } = usePrintCopy()
  const session = usePrinterStore(state => state.connectionStatus.type === 'connected' ? state.sshConfig : null)
  const activeConfig = config || session
  const [job, setJob] = useState(initialJob)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    setJob(initialJob)
    setError('')
    setChecked(false)
    async function refresh() {
      const result = await getPrintJob(jobId)
      if (disposed) return
      if (result.success && result.data) { setJob(result.data); setError('') }
      else setError(result.error || 'Progress unavailable')
      if (!result.data || !['Completed', 'Cancelled', 'Failed'].includes(result.data.status)) timer = setTimeout(refresh, 750)
    }
    void refresh()
    return () => { disposed = true; clearTimeout(timer) }
  }, [jobId])
  const percent = job ? uploadPercent(job) : undefined
  async function cancel() {
    if (!activeConfig) return
    setCancelling(true)
    try {
      const result = await cancelPrintJob(jobId, activeConfig)
      setError(result.success ? '' : result.error || 'Cancellation failed')
    } finally { setCancelling(false) }
  }
  async function linkAccount() {
    if (!activeConfig) return
    setCancelling(true)
    try {
      const result = await linkJobAccount(jobId, activeConfig)
      if (result.success && result.data) { setJob(result.data); setChecked(false); setError('') }
      else setError(result.error || 'Could not link account')
    } finally { setCancelling(false) }
  }
  async function resolve(printed: boolean) {
    setCancelling(true)
    try {
      const result = await resolveSubmission(jobId, printed)
      if (result.success && result.data) { setJob(result.data); setError('') }
      else setError(result.error || 'Could not save your confirmation')
    } finally { setCancelling(false) }
  }
  const note = job?.status === 'Completed' ? (job.progress?.stage === 'OutputConfirmed' ? text.confirmed : text.departed) : job?.progress?.stage === 'SubmissionUnknown' ? text.uncertain : null
  return <div className="space-y-3 py-2 text-sm">
    <div className="flex items-center justify-between gap-4">
      <p role="status" className="font-medium">{job ? jobStatusLabel(job, locale) : text.preparing}</p>
      {percent !== undefined && <span className="tabular-nums text-muted-foreground">{percent}%</span>}
    </div>
    {percent !== undefined && <>
      <progress className="block h-1.5 w-full overflow-hidden rounded-full accent-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary" max={100} value={percent} aria-label={text.upload} />
      <p className="text-xs tabular-nums text-muted-foreground">{formatBytes(job?.progress?.bytes_sent || 0)} / {formatBytes(job?.progress?.total_bytes || 0)}</p>
    </>}
    {job && queuePositionLabel(job, locale) && <p className="text-xs text-muted-foreground">{queuePositionLabel(job, locale)}</p>}
    {job?.tracking?.device_message && <p className="text-xs text-muted-foreground">{job.tracking.device_message}</p>}
    {job?.lpq_job_id && <p className="text-xs text-muted-foreground">{text.jobId} #{job.lpq_job_id}</p>}
    {note && <p className="text-xs leading-5 text-muted-foreground">{note}</p>}
    {job && !job.submission && ['Queued', 'Printing'].includes(job.status) && <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-xs leading-5">{text.olderJob}</p>
      {activeConfig && <p className="break-all text-xs">{activeConfig.username}@{activeConfig.host}:{activeConfig.port}</p>}
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />{text.originalAccount}</label>
      <Button size="sm" variant="outline" disabled={!activeConfig || !checked || cancelling} onClick={linkAccount}>{text.linkAccount}</Button>
    </div>}
    {job && ((job.status === 'Queued' && !job.lpq_job_id) || (job.status === 'Completed' && job.progress?.stage !== 'OutputConfirmed')) && <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-xs leading-5">{job.status === 'Completed' ? text.departed : text.unresolved}</p>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />{text.checked}</label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!checked || cancelling} onClick={() => resolve(true)}>{text.received}</Button>
        <Button size="sm" variant="outline" disabled={!checked || cancelling} onClick={() => resolve(false)}>{text.notPrinted}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{text.historyOnly}</p>
    </div>}
    {error && <details className="text-xs"><summary role="alert" className="cursor-pointer text-destructive">{text.progressError}</summary><p className="mt-2 break-words text-muted-foreground">{error}</p></details>}
    {activeConfig && job?.status === 'Uploading' && job.progress?.stage !== 'Submitting' && <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={cancelling} onClick={cancel}>{cancelling ? text.cancelling : text.cancel}</Button>}
  </div>
}
