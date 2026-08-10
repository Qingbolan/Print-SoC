import { useEffect, useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePrinterStore } from '@/store/printer-store'
import { getAllPrintJobs, cancelPrintJob, deletePrintJob, checkActiveJobs } from '@/lib/printer-api'
import { JobDetailDialog } from '@/components/jobs/JobDetailDialog'
import type { PrintJob } from '@/types/printer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageScaffold } from '@/components/layout/PageScaffold'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import {
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  Upload,
  Printer as PrinterIcon,
  Trash2,
  Ban,
  Eye,
  RefreshCw,
  History,
} from 'lucide-react'
import type { PrintJobStatus } from '@/types/printer'

const statusConfig: Record<
  PrintJobStatus,
  { color: string; icon: React.ReactNode; label: string }
> = {
  Pending: {
    color: 'bg-muted text-muted-foreground border-border/70',
    icon: <Clock className="w-4 h-4" />,
    label: 'Pending',
  },
  Uploading: {
    color: 'bg-accent/10 text-accent border-accent/20',
    icon: <Upload className="w-4 h-4" />,
    label: 'Uploading',
  },
  Queued: {
    color: 'bg-warning/10 text-warning-foreground',
    icon: <Clock className="w-4 h-4" />,
    label: 'Queued',
  },
  Printing: {
    color: 'bg-primary/10 text-primary',
    icon: <PrinterIcon className="w-4 h-4" />,
    label: 'Printing',
  },
  Completed: {
    color: 'bg-success/10 text-success',
    icon: <CheckCircle2 className="w-4 h-4" />,
    label: 'Completed',
  },
  Failed: {
    color: 'bg-destructive/10 text-destructive',
    icon: <XCircle className="w-4 h-4" />,
    label: 'Failed',
  },
  Cancelled: {
    color: 'bg-muted text-muted-foreground border-border/70',
    icon: <XCircle className="w-4 h-4" />,
    label: 'Cancelled',
  },
}

export default function JobsPage() {
  const navigate = useNavigate()
  const { printJobs, setPrintJobs, removePrintJob, sshConfig, connectionStatus } = usePrinterStore()
  const activeSshConfig = connectionStatus.type === 'connected' ? sshConfig : null
  const [selectedTab, setSelectedTab] = useState<'active' | 'history'>('active')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedJob, setSelectedJob] = useState<PrintJob | null>(null)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)

  const loadJobs = useCallback(async (options?: { checkRemote?: boolean; silent?: boolean }) => {
    if (!options?.silent) {
      setIsRefreshing(true)
    }

    try {
      if (options?.checkRemote && activeSshConfig) {
        await checkActiveJobs(activeSshConfig)
      }

      const result = await getAllPrintJobs()
      if (result.success && result.data) {
        setPrintJobs(result.data)
      }
    } finally {
      if (!options?.silent) {
        setIsRefreshing(false)
      }
    }
  }, [activeSshConfig, setPrintJobs])

  useEffect(() => {
    loadJobs({ checkRemote: true })
  }, [loadJobs])

  const handleViewJob = useCallback((job: PrintJob) => {
    setSelectedJob(job)
    setDetailDialogOpen(true)
  }, [])

  const handleCancelJob = async (jobId: string) => {
    if (!activeSshConfig) {
      toast.error('Not connected to SSH')
      return
    }

    const result = await cancelPrintJob(jobId, activeSshConfig)
    if (result.success) {
      toast.success('Job cancelled')
      loadJobs({ checkRemote: true })
    } else {
      toast.error(result.error || 'Failed to cancel job')
    }
  }

  const handleDeleteJob = async (jobId: string) => {
    const result = await deletePrintJob(jobId)
    if (result.success) {
      removePrintJob(jobId)
      toast.success('Job deleted')
    } else {
      toast.error(result.error || 'Failed to delete job')
    }
  }

  const activeJobs = printJobs.filter(
    (job) =>
      job.status === 'Pending' ||
      job.status === 'Uploading' ||
      job.status === 'Queued' ||
      job.status === 'Printing'
  )

  const completedJobs = printJobs.filter(
    (job) =>
      job.status === 'Completed' || job.status === 'Failed' || job.status === 'Cancelled'
  )

  const displayJobs = selectedTab === 'active' ? activeJobs : completedJobs

  return (
    <PageScaffold
      header={
        <PageHeader
          title="Print queue"
          description="Track active submissions and completed documents"
          icon={<FileText />}
          actions={
            <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadJobs({ checkRemote: true })}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button onClick={() => navigate('/home')}>
              <Upload className="w-4 h-4 mr-2" />
              New Print Job
            </Button>
            </>
          }
        />
      }
      metrics={
        <div className="grid grid-cols-3 overflow-hidden rounded-md bg-card">
          {[
            { label: 'Active', value: activeJobs.length, icon: Clock },
            { label: 'Completed', value: completedJobs.filter(j => j.status === 'Completed').length, icon: CheckCircle2 },
            { label: 'Failed', value: completedJobs.filter(j => j.status === 'Failed').length, icon: XCircle },
          ].map(({ label, value, icon: Icon }, index) => (
            <div key={label} className={`flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5 ${index > 0 ? 'border-l border-border/60' : ''}`}>
              <Icon className="hidden size-4 shrink-0 text-primary sm:block" />
              <div className="min-w-0">
                <div className="text-lg font-semibold leading-5 tabular-nums text-foreground">{value}</div>
                <div className="truncate text-xs text-muted-foreground">{label}</div>
              </div>
            </div>
          ))}
        </div>
      }
      navigation={
        <SegmentedControl
          ariaLabel="Job view"
          value={selectedTab}
          onValueChange={setSelectedTab}
          mobileLayout="equal"
          items={[
            { value: 'active', label: 'Active', icon: PrinterIcon, count: activeJobs.length },
            { value: 'history', label: 'History', icon: History, count: completedJobs.length },
          ]}
        />
      }
      contentWidth="wide"
    >
        {displayJobs.length === 0 ? (
          <div className="flex items-center justify-center rounded-md bg-card px-6 py-16 text-center text-muted-foreground">
            <div>
            <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-sm font-medium text-foreground">
              {selectedTab === 'active' ? 'No active print jobs' : 'No job history'}
            </p>
            <p className="text-sm mt-2">
              {selectedTab === 'active' ? 'Start a new print job from the Home page' : 'Completed jobs will appear here'}
            </p>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md bg-card">
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-4 bg-[#0B3556] px-5 py-2.5 text-xs font-semibold uppercase text-slate-200 md:grid">
              <span>Document</span>
              <span>Status</span>
              <span>Options</span>
              <span>Submitted</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="divide-y divide-border/60">
            {displayJobs.map((job) => (
              <div key={job.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] md:px-5">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <FileText className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{job.name}</div>
                    <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{job.printer}</div>
                    {job.error && <div className="mt-2 truncate text-xs text-destructive">{job.error}</div>}
                  </div>
                </div>
                <div className="justify-self-end md:justify-self-start">
                    <Badge
                      variant="outline"
                      className={`${statusConfig[job.status].color} flex-shrink-0`}
                    >
                      {statusConfig[job.status].icon}
                      <span className="ml-1">{statusConfig[job.status].label}</span>
                    </Badge>
                </div>
                <div className="hidden text-xs leading-5 text-muted-foreground md:block">
                  <div className="font-medium text-foreground">{job.settings.copies} × {job.settings.paper_size}</div>
                  <div>{job.settings.duplex === 'Simplex' ? 'Simplex' : 'Duplex'}{job.settings.pages_per_sheet > 1 ? ` · ${job.settings.pages_per_sheet}-up` : ''}</div>
                </div>
                <div className="hidden text-xs leading-5 text-muted-foreground md:block">
                  <div>{new Date(job.created_at).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                  <div>{new Date(job.created_at).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <div className="col-span-2 flex items-center justify-end gap-2 md:col-span-1 md:gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleViewJob(job)}
                      title="View job"
                      aria-label="View job"
                      className="max-md:w-auto max-md:px-3"
                    >
                      <Eye className="size-4" />
                      <span className="md:hidden">View</span>
                    </Button>

                    {selectedTab === 'active' ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="icon" className="text-destructive hover:text-destructive/80 max-md:w-auto max-md:px-3" title="Cancel job" aria-label="Cancel job">
                            <Ban className="w-4 h-4" />
                            <span className="md:hidden">Cancel</span>
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Cancel Print Job?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will cancel the print job. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleCancelJob(job.id)}>
                              Confirm
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="icon" className="text-destructive hover:text-destructive/80 max-md:w-auto max-md:px-3" title="Delete job" aria-label="Delete job">
                            <Trash2 className="w-4 h-4" />
                            <span className="md:hidden">Delete</span>
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Print Job?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will remove the job from history. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeleteJob(job.id)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                </div>
              </div>
            ))}
            </div>
          </div>
        )}
      {/* Job Detail Dialog */}
      <JobDetailDialog
        job={selectedJob}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
      />
    </PageScaffold>
  )
}
