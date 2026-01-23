import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePrinterStore } from '@/store/printer-store'
import { getAllPrintJobs, getPDFInfo } from '@/lib/printer-api'
import { safeDialogOpen } from '@/lib/tauri-utils'
import { toast } from 'sonner'
import { FileText, AlertCircle, Clock, Printer, Edit3, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AnimatedCard } from '@/components/magic/animated-card'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { PrintJobStatus, PrintJob, DraftPrintJob } from '@/types/printer'

const statusColors: Record<PrintJobStatus, string> = {
  Pending: 'text-muted-foreground',
  Uploading: 'text-accent',
  Queued: 'text-warning',
  Printing: 'text-primary',
  Completed: 'text-success',
  Failed: 'text-destructive',
  Cancelled: 'text-muted-foreground',
}

export default function ModernHomePageV2() {
  const navigate = useNavigate()
  const { isConnected, printJobs, setPrintJobs, setCurrentFile, draftJobs, removeDraftJob } = usePrinterStore()
  const [loading, setLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [errorDialog, setErrorDialog] = useState<{
    open: boolean
    title: string
    message: string
    technicalDetails?: string
  }>({
    open: false,
    title: '',
    message: '',
  })

  const loadJobs = async () => {
    const result = await getAllPrintJobs()
    if (result.success && result.data) {
      setPrintJobs(result.data)
    }
  }

  const handleFileSelect = useCallback(async (filePath: string) => {
    setLoading(true)
    try {
      const info = await getPDFInfo(filePath)
      if (info.success && info.data) {
        setCurrentFile(null, filePath)
        const sessionId = Math.random().toString(36).substring(2, 10)
        navigate(`/preview/${sessionId}`, { state: { filePath, pdfInfo: info.data } })
      } else {
        // Show detailed error message from backend
        const errorMsg = info.error || 'Unknown error occurred'

        // Show detailed error dialog
        setErrorDialog({
          open: true,
          title: 'Failed to Load PDF',
          message: 'The PDF file could not be loaded. Please check the error details below.',
          technicalDetails: errorMsg,
        })

        // Also show toast for quick notification
        toast.error('Failed to load PDF')
        console.error('PDF load error:', errorMsg)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : undefined

      // Show detailed error dialog
      setErrorDialog({
        open: true,
        title: 'Error Loading File',
        message: 'An unexpected error occurred while loading the PDF file.',
        technicalDetails: errorStack || errorMsg,
      })

      // Also show toast for quick notification
      toast.error('Error loading file')
      console.error('PDF load exception:', error)
    } finally {
      setLoading(false)
    }
  }, [setCurrentFile, navigate])

  const handleBrowseFile = useCallback(async () => {
    const file = await safeDialogOpen({
      multiple: false,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (file) {
      handleFileSelect(file as string)
    }
  }, [handleFileSelect])

  const handleContinueDraft = useCallback((draft: typeof draftJobs[0]) => {
    // Navigate to preview with draft data
    const sessionId = Math.random().toString(36).substring(2, 10)
    navigate(`/preview/${sessionId}`, {
      state: {
        filePath: draft.file_path,
        pdfInfo: draft.pdf_info,
        draftSettings: draft.settings,
        draftPrinter: draft.selected_printer,
      }
    })
  }, [navigate])

  const handleDeleteDraft = useCallback((draftId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    removeDraftJob(draftId)
    toast.success('Draft removed')
  }, [removeDraftJob])

  useEffect(() => {
    if (!isConnected) {
      navigate('/login')
      return
    }
    loadJobs()
  }, [isConnected, navigate])

  // Tauri file drop event listener (Tauri v2 API)
  useEffect(() => {
    let unlisten: (() => void) | undefined

    const setupListeners = async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
        const webview = getCurrentWebviewWindow()

        unlisten = await webview.onDragDropEvent((event) => {
          const payload = event.payload as any
          if (payload.type === 'enter' || payload.type === 'over') {
            setIsDragging(true)
          } else if (payload.type === 'leave') {
            setIsDragging(false)
          } else if (payload.type === 'drop') {
            const paths: string[] = payload.paths || []
            const pdfPath = paths.find((p) => p.toLowerCase().endsWith('.pdf'))
            if (pdfPath) {
              handleFileSelect(pdfPath)
            } else {
              toast.error('Please drop a PDF file')
            }
            setIsDragging(false)
          }
        })
      } catch (error) {
        console.error('Error setting up drag & drop listener:', error)
      }
    }

    setupListeners()

    return () => {
      if (unlisten) unlisten()
    }
  }, [handleFileSelect])

  const recentJobs = useMemo(() => printJobs.slice(0, 10), [printJobs])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-8 border-b border-border/50">
        <PageHeader
          title="Print@SoC"
          description="NUS School of Computing Printing Service"
          icon={<Printer className="w-8 h-8" />}
        />
      </div>

      {/* Main content - Left/Right layout */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left side - Upload area */}
        <div className="flex-1 p-6 overflow-y-auto">
          <AnimatedCard
            className={`h-full flex items-center justify-center border-2 border-dashed backdrop-blur-sm fluent-transition ${
              isDragging
                ? 'border-primary bg-primary/10 scale-[0.98]'
                : 'border-border bg-card/30'
            }`}
          >
            {loading ? (
              <div className="text-center">
                <div className="text-4xl mb-4">⏳</div>
                <p className="text-muted-foreground">Loading PDF...</p>
              </div>
            ) : isDragging ? (
              <div className="text-center">
                <div className="text-5xl mb-4">📥</div>
                <h2 className="text-xl font-semibold text-primary mb-2">
                  Drop PDF Here
                </h2>
                <p className="text-muted-foreground">
                  Release to upload
                </p>
              </div>
            ) : (
              <div className="text-center">
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Upload PDF Document
                </h2>
                <p className="text-muted-foreground mb-6">
                  Drag and drop a file here, or click to browse
                </p>
                <Button
                  onClick={handleBrowseFile}
                  size="lg"
                  className="rounded-xl fluent-shadow-xs hover:fluent-shadow-sm fluent-transition"
                >
                  Browse Files
                </Button>
                <div className="mt-4 text-sm text-muted-foreground/70">
                  PDF files only · Instant preview
                </div>
              </div>
            )}
          </AnimatedCard>
        </div>

        {/* Right side - Drafts & Recent jobs */}
        <div className="w-80 border-l border-border/50 bg-card/30 flex flex-col">
          {/* Drafts Section */}
          {draftJobs.length > 0 && (
            <>
              <div className="px-4 py-3 border-b border-border/50 bg-warning/5">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-warning" />
                  Unsaved Drafts
                  <span className="ml-auto text-xs text-warning bg-warning/20 px-1.5 py-0.5 rounded-full">
                    {draftJobs.length}
                  </span>
                </h3>
              </div>
              <div className="divide-y divide-border/50 border-b border-border/50">
                {draftJobs.slice(0, 3).map((draft: DraftPrintJob) => (
                  <Button
                    key={draft.id}
                    onClick={() => handleContinueDraft(draft)}
                    variant="ghost"
                    className="w-full h-auto px-4 py-3 justify-start rounded-none hover:bg-warning/10 fluent-transition overflow-hidden group"
                  >
                    <div className="flex items-center gap-3 w-full overflow-hidden">
                      <FileText className="w-4 h-4 text-warning flex-shrink-0" />
                      <div className="flex-1 min-w-0 overflow-hidden text-left">
                        <div className="text-sm font-medium text-foreground truncate">
                          {draft.name}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {draft.pdf_info.num_pages} pages · {draft.settings.copies} copies
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => handleDeleteDraft(draft.id, e)}
                      >
                        <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  </Button>
                ))}
              </div>
            </>
          )}

          {/* Recent Jobs Section */}
          <div className="px-4 py-3 border-b border-border/50">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Recent Print Jobs
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto">
            {recentJobs.length === 0 ? (
              <div className="flex items-center justify-center h-full px-4">
                <div className="text-center text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No print history</p>
                  <p className="text-xs mt-1">Upload a PDF to start</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {recentJobs.map((job: PrintJob) => (
                  <Button
                    key={job.id}
                    onClick={() => {
                      if (job.file_path) {
                        handleFileSelect(job.file_path)
                      } else {
                        navigate('/jobs')
                      }
                    }}
                    variant="ghost"
                    className="w-full h-auto px-4 py-3 justify-start rounded-none hover:bg-accent/50 fluent-transition overflow-hidden"
                  >
                    <div className="flex items-center gap-3 w-full overflow-hidden">
                      <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0 overflow-hidden text-left">
                        <div className="text-sm font-medium text-foreground truncate">
                          {job.name}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">
                            {new Date(job.created_at).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span className={`text-xs font-medium ${statusColors[job.status]}`}>
                            {job.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            )}
          </div>

          {printJobs.length > 10 && (
            <div className="px-4 py-3 border-t border-border/50">
              <Button
                onClick={() => navigate('/jobs')}
                variant="ghost"
                size="sm"
                className="w-full text-sm fluent-transition"
              >
                View all {printJobs.length} jobs
              </Button>
            </div>
          )}
        </div>

      </div>

      {/* Error Dialog */}
      <AlertDialog
        open={errorDialog.open}
        onOpenChange={(open) => setErrorDialog({ ...errorDialog, open })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-destructive" />
              <AlertDialogTitle>{errorDialog.title}</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-left">
              {errorDialog.message}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {errorDialog.technicalDetails && (
            <div className="mt-2">
              <div className="text-sm font-medium text-foreground mb-2">Technical Details:</div>
              <div className="bg-muted rounded-lg p-3 max-h-64 overflow-y-auto">
                <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-words">
                  {errorDialog.technicalDetails}
                </pre>
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setErrorDialog({ ...errorDialog, open: false })}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
