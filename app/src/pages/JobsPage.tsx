import { useEffect, useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePrinterStore } from '@/store/printer-store'
import { getAllPrintJobs, cancelPrintJob, deletePrintJob } from '@/lib/printer-api'
import { JobDetailDialog } from '@/components/jobs/JobDetailDialog'
import type { PrintJob } from '@/types/printer'
import { SimpleCard, SimpleCardHeader, SimpleCardTitle, SimpleCardDescription, SimpleCardContent } from '@/components/ui/simple-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGroup, StatItem } from '@/components/ui/stat-item'
import { cn } from '@/lib/utils'
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
    color: 'bg-muted-foreground',
    icon: <Clock className="w-4 h-4" />,
    label: 'Pending',
  },
  Uploading: {
    color: 'bg-accent',
    icon: <Upload className="w-4 h-4" />,
    label: 'Uploading',
  },
  Queued: {
    color: 'bg-warning text-warning-foreground',
    icon: <Clock className="w-4 h-4" />,
    label: 'Queued',
  },
  Printing: {
    color: 'bg-primary',
    icon: <PrinterIcon className="w-4 h-4" />,
    label: 'Printing',
  },
  Completed: {
    color: 'bg-success',
    icon: <CheckCircle2 className="w-4 h-4" />,
    label: 'Completed',
  },
  Failed: {
    color: 'bg-destructive',
    icon: <XCircle className="w-4 h-4" />,
    label: 'Failed',
  },
  Cancelled: {
    color: 'bg-muted-foreground',
    icon: <XCircle className="w-4 h-4" />,
    label: 'Cancelled',
  },
}

export default function JobsPage() {
  const navigate = useNavigate()
  const { printJobs, setPrintJobs, removePrintJob, sshConfig } = usePrinterStore()
  const [selectedTab, setSelectedTab] = useState<'active' | 'history'>('active')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedJob, setSelectedJob] = useState<PrintJob | null>(null)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)

  useEffect(() => {
    loadJobs()
  }, [])

  const loadJobs = async () => {
    setIsRefreshing(true)
    const result = await getAllPrintJobs()
    if (result.success && result.data) {
      setPrintJobs(result.data)
    }
    setIsRefreshing(false)
  }

  const handleViewJob = useCallback((job: PrintJob) => {
    setSelectedJob(job)
    setDetailDialogOpen(true)
  }, [])

  const handleCancelJob = async (jobId: string) => {
    if (!sshConfig) {
      toast.error('Not connected to SSH')
      return
    }

    const result = await cancelPrintJob(jobId, sshConfig)
    if (result.success) {
      toast.success('Job cancelled')
      loadJobs()
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
    <div className="h-full flex flex-col">
      {/* Header Section */}
      <div className="p-8 space-y-8 border-b border-border/50">
        {/* Header with Action Buttons */}
        <div className="flex items-start justify-between">
          <PageHeader
            title="Print Jobs"
            description="Manage and track your print jobs"
            icon={<FileText className="w-8 h-8" />}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadJobs}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button onClick={() => navigate('/home')}>
              <Upload className="w-4 h-4 mr-2" />
              New Print Job
            </Button>
          </div>
        </div>

        {/* Stats */}
        <StatGroup>
          <StatItem
            icon={Clock}
            value={activeJobs.length}
            label="Active"
          />
          <div className="w-px h-8 bg-border/50" />
          <StatItem
            icon={CheckCircle2}
            value={completedJobs.filter(j => j.status === 'Completed').length}
            label="Completed"
          />
          <div className="w-px h-8 bg-border/50" />
          <StatItem
            icon={XCircle}
            value={completedJobs.filter(j => j.status === 'Failed').length}
            label="Failed"
          />
        </StatGroup>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSelectedTab('active')}
            className={cn(
              'px-6 py-2 rounded-md font-medium transition-colors flex items-center gap-2',
              selectedTab === 'active'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
          >
            <PrinterIcon className="w-4 h-4" />
            <span>Active</span>
            <span
              className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center font-semibold text-sm",
                activeJobs.length > 0
                  ? "bg-warning text-warning-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {activeJobs.length}
            </span>
          </button>

          <button
            onClick={() => setSelectedTab('history')}
            className={cn(
              'px-6 py-2 rounded-md font-medium transition-colors flex items-center gap-2',
              selectedTab === 'history'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
          >
            <History className="w-4 h-4" />
            <span>History</span>
            <span
              className="w-7 h-7 rounded-full flex items-center justify-center font-semibold text-sm bg-muted text-muted-foreground"
            >
              {completedJobs.length}
            </span>
          </button>
        </div>
      </div>

      {/* Job Cards */}
      <div className="flex-1 overflow-y-auto p-6">
        {displayJobs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">
              {selectedTab === 'active' ? 'No active print jobs' : 'No job history'}
            </p>
            <p className="text-sm mt-2">
              {selectedTab === 'active' ? 'Start a new print job from the Home page' : 'Completed jobs will appear here'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl">
            {displayJobs.map((job) => (
              <SimpleCard key={job.id} variant="default" hoverable>
                <SimpleCardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <SimpleCardTitle className="flex items-center gap-2 truncate">
                        <FileText className="w-5 h-5 flex-shrink-0" />
                        <span className="truncate">{job.name}</span>
                      </SimpleCardTitle>
                      <SimpleCardDescription className="mt-1">
                        {job.printer} • {job.settings.copies} {job.settings.copies > 1 ? 'copies' : 'copy'}
                      </SimpleCardDescription>
                    </div>
                    <Badge
                      variant="secondary"
                      className={`${statusConfig[job.status].color} text-white flex-shrink-0`}
                    >
                      {statusConfig[job.status].icon}
                      <span className="ml-1">{statusConfig[job.status].label}</span>
                    </Badge>
                  </div>
                </SimpleCardHeader>
                <SimpleCardContent className="space-y-4">
                  {/* Time */}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    {new Date(job.created_at).toLocaleString()}
                  </div>

                  {/* Error message */}
                  {job.error && (
                    <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                      {job.error}
                    </div>
                  )}

                  {/* Settings badges */}
                  <div className="flex flex-wrap gap-2">
                    {job.settings.duplex !== 'Simplex' && (
                      <Badge variant="outline">Duplex</Badge>
                    )}
                    {job.settings.pages_per_sheet > 1 && (
                      <Badge variant="outline">{job.settings.pages_per_sheet}-up</Badge>
                    )}
                    <Badge variant="outline">{job.settings.paper_size}</Badge>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewJob(job)}
                      className="flex-1"
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      View
                    </Button>

                    {selectedTab === 'active' ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive/80">
                            <Ban className="w-4 h-4" />
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
                          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive/80">
                            <Trash2 className="w-4 h-4" />
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
                </SimpleCardContent>
              </SimpleCard>
            ))}
          </div>
        )}
      </div>

      {/* Job Detail Dialog */}
      <JobDetailDialog
        job={selectedJob}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
      />
    </div>
  )
}
