import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePrinterStore } from '@/store/printer-store'
import { getAllPrintJobs, cancelPrintJob, deletePrintJob, getPDFInfo } from '@/lib/printer-api'
import { SimpleCard, SimpleCardHeader, SimpleCardTitle, SimpleCardDescription, SimpleCardContent } from '@/components/ui/simple-card'
import { SectionHeader, Section, PageContainer } from '@/components/ui/section-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
} from 'lucide-react'
import type { PrintJobStatus } from '@/types/printer'

const statusConfig: Record<
  PrintJobStatus,
  { color: string; icon: React.ReactNode; label: string }
> = {
  Pending: {
    color: 'bg-gray-500',
    icon: <Clock className="w-4 h-4" />,
    label: 'Pending',
  },
  Uploading: {
    color: 'bg-blue-500',
    icon: <Upload className="w-4 h-4" />,
    label: 'Uploading',
  },
  Queued: {
    color: 'bg-yellow-500',
    icon: <Clock className="w-4 h-4" />,
    label: 'Queued',
  },
  Printing: {
    color: 'bg-purple-500',
    icon: <PrinterIcon className="w-4 h-4" />,
    label: 'Printing',
  },
  Completed: {
    color: 'bg-green-500',
    icon: <CheckCircle2 className="w-4 h-4" />,
    label: 'Completed',
  },
  Failed: {
    color: 'bg-red-500',
    icon: <XCircle className="w-4 h-4" />,
    label: 'Failed',
  },
  Cancelled: {
    color: 'bg-gray-500',
    icon: <XCircle className="w-4 h-4" />,
    label: 'Cancelled',
  },
}

export default function JobsPage() {
  const navigate = useNavigate()
  const { printJobs, setPrintJobs, removePrintJob, sshConfig } = usePrinterStore()

  useEffect(() => {
    loadJobs()
  }, [])

  const loadJobs = async () => {
    const result = await getAllPrintJobs()
    if (result.success && result.data) {
      setPrintJobs(result.data)
    }
  }

  const handlePreviewJob = useCallback(async (filePath: string) => {
    try {
      const info = await getPDFInfo(filePath)
      if (info.success && info.data) {
        navigate('/preview', { state: { filePath, pdfInfo: info.data } })
      } else {
        toast.error('Failed to load PDF: ' + (info.error || 'File may have been moved or deleted'))
      }
    } catch (error) {
      toast.error('Failed to open preview: File may have been moved or deleted')
    }
  }, [navigate])

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

  return (
    <PageContainer>
      <SectionHeader
        title="Print Jobs"
        description="Manage and track your print jobs"
        icon={FileText}
        action={
          <Button onClick={() => navigate('/print/new')}>
            <Upload className="w-4 h-4 mr-2" />
            New Print Job
          </Button>
        }
      />

      <Section>
        {/* Active Jobs */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">
            Active Jobs
            <span className="text-sm font-normal text-muted-foreground ml-2">
              Currently printing or in queue ({activeJobs.length})
            </span>
          </h3>
          <SimpleCard variant="bordered" padding="md">
          {activeJobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No active print jobs
            </div>
          ) : (
            <div className="space-y-3">
              {activeJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium">{job.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {job.printer} • {job.settings.copies} {job.settings.copies > 1 ? 'copies' : 'copy'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(job.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant="secondary"
                      className={`${statusConfig[job.status].color} text-white`}
                    >
                      {statusConfig[job.status].icon}
                      <span className="ml-1">{statusConfig[job.status].label}</span>
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePreviewJob(job.file_path)}
                      title="Preview file"
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm">
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
                  </div>
                </div>
              ))}
            </div>
          )}
          </SimpleCard>
        </div>

        {/* Completed Jobs */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">
            History
            <span className="text-sm font-normal text-muted-foreground ml-2">
              Past print jobs ({completedJobs.length})
            </span>
          </h3>
          <SimpleCard variant="bordered" padding="md">
          {completedJobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No completed jobs
            </div>
          ) : (
            <div className="space-y-3">
              {completedJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium">{job.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {job.printer} • {job.settings.copies} {job.settings.copies > 1 ? 'copies' : 'copy'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(job.created_at).toLocaleString()}
                      </div>
                      {job.error && (
                        <div className="text-xs text-red-500 mt-1">{job.error}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant="secondary"
                      className={`${statusConfig[job.status].color} text-white`}
                    >
                      {statusConfig[job.status].icon}
                      <span className="ml-1">{statusConfig[job.status].label}</span>
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePreviewJob(job.file_path)}
                      title="Preview file"
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm">
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
                  </div>
                </div>
              ))}
            </div>
          )}
          </SimpleCard>
        </div>
      </Section>
    </PageContainer>
  )
}
