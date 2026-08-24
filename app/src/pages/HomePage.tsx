import { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePrinterStore } from '@/store/printer-store'
import { getAllPrintJobs, getBackupPath, getPDFInfo } from '@/lib/printer-api'
import { isTauriAvailable, safeDialogOpen } from '@/lib/tauri-utils'
import { toast } from 'sonner'
import { FileText, Printer, Edit3, X, Loader2, UploadCloud, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageScaffold } from '@/components/layout/PageScaffold'
import { FileErrorDialog } from '@/components/common/FileErrorDialog'
import type { PrintJobStatus, PrintJob, DraftPrintJob } from '@/types/printer'

const statusColors: Record<PrintJobStatus, string> = {
  Pending: 'text-muted-foreground',
  Uploading: 'text-[var(--brand-orange)]',
  Queued: 'text-[var(--brand-orange)]',
  Printing: 'text-primary',
  Completed: 'text-success',
  Failed: 'text-destructive',
  Cancelled: 'text-muted-foreground',
}

export default function ModernHomePageV2() {
  const navigate = useNavigate()
  const location = useLocation()
  const { connectionStatus, printJobs, setPrintJobs, setCurrentFile, draftJobs, removeDraftJob } = usePrinterStore()
  const isConnected = connectionStatus.type === 'connected'
  const isUiPreview = import.meta.env.DEV && new URLSearchParams(location.search).has('ui-preview')
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

  const handleFileSelect = useCallback(async (filePath: string, jobId?: string) => {
    setLoading(true)
    try {
      let resolvedPath = filePath
      let info = await getPDFInfo(resolvedPath)

      if (!info.success && jobId && info.error?.includes('PDF file not found')) {
        const backup = await getBackupPath(jobId)
        if (backup.success && backup.data) {
          resolvedPath = backup.data
          info = await getPDFInfo(resolvedPath)
        }
      }

      if (info.success && info.data) {
        setCurrentFile(null, resolvedPath)
        const sessionId = Math.random().toString(36).substring(2, 10)
        navigate(`/preview/${sessionId}`, { state: { filePath: resolvedPath, pdfInfo: info.data } })
      } else {
        const errorMsg = info.error || 'Unknown error occurred'
        const missingFile = errorMsg.includes('PDF file not found')

        setErrorDialog({
          open: true,
          title: missingFile ? 'Source file unavailable' : 'Failed to load PDF',
          message: missingFile
            ? 'The original PDF and its local backup are no longer available. Choose the document again to continue.'
            : 'The PDF could not be opened. Review the technical details or choose another document.',
          technicalDetails: errorMsg,
        })

        toast.error(missingFile ? 'Source file unavailable' : 'Failed to load PDF')
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
    if (!isConnected && !isUiPreview) {
      navigate('/login')
      return
    }
    loadJobs()
  }, [isConnected, isUiPreview, navigate])

  // Tauri file drop event listener (Tauri v2 API)
  useEffect(() => {
    if (!isTauriAvailable()) return

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

  const recentJobs = useMemo(() => printJobs.slice(0, 6), [printJobs])
  return (
    <PageScaffold
      header={
        <PageHeader
          title="Print workbench"
          description="Prepare and review a PDF before printing"
          icon={<Printer />}
        />
      }
      contentClassName="overflow-y-auto"
      contentInnerClassName="lg:h-full"
      contentWidth="full"
    >
      <div className="grid items-stretch gap-4 lg:h-full lg:min-h-0 lg:grid-cols-3">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-md bg-card lg:col-span-2">
          <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5 sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase text-primary">New job</p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">Add a PDF document</h2>
            </div>
            <span className="font-mono text-xs text-muted-foreground">PDF / A4 / A3</span>
          </div>
          <div
            className={`relative mx-3 mb-3 flex flex-1 items-center justify-center overflow-hidden rounded-md border border-dashed px-6 py-16 transition-colors sm:mx-4 sm:mb-4 sm:py-24 ${
              isDragging
                ? 'border-[var(--border-hover)] bg-primary/7'
                : 'border-[var(--border-hover)]/70 bg-workspace'
            }`}
            aria-label="PDF upload area"
          >
            {loading ? (
              <div className="flex items-center justify-center text-center">
                <div>
                  <Loader2 className="mx-auto mb-4 h-9 w-9 animate-spin text-muted-foreground" />
                  <p className="text-muted-foreground">Loading PDF...</p>
                </div>
              </div>
            ) : isDragging ? (
              <div className="flex items-center justify-center text-center">
                <div>
                  <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary dark:bg-background/30">
                    <UploadCloud className="h-8 w-8" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-primary">
                    Drop PDF Here
                  </h3>
                  <p className="text-muted-foreground">
                    Release to upload
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center text-center">
                <div>
                  <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <UploadCloud className="h-6 w-6" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-foreground">Choose a PDF</h3>
                  <p className="mb-6 text-sm leading-6 text-muted-foreground">
                    <span className="sm:hidden">Select a PDF from your device.</span>
                    <span className="hidden sm:inline">Drag a file here or browse your computer.</span>
                  </p>
                  <Button
                    onClick={handleBrowseFile}
                    className="px-6"
                  >
                    Browse Files
                  </Button>
                  <div className="mt-4 text-xs text-muted-foreground/80">
                    The document opens in print preview before submission
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-md bg-card">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">Recent activity</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">Submitted from this device</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/jobs')}>
              All jobs <ArrowRight className="size-4" />
            </Button>
          </div>
          {recentJobs.length === 0 ? (
            <div className="flex flex-1 items-center justify-center bg-workspace/60 px-6 py-12 text-center">
              <div>
                <FileText className="mx-auto mb-2 size-6 text-muted-foreground/60" />
                <p className="text-sm font-medium text-foreground">No print activity yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Submitted documents will appear here.</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 divide-y divide-border/60 overflow-y-auto">
              {recentJobs.map((job: PrintJob) => (
                <button
                  key={job.id}
                  onClick={() => job.file_path ? handleFileSelect(job.file_path) : navigate('/jobs')}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-accent/60"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <FileText className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{job.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {job.printer} · {new Date(job.created_at).toLocaleDateString('en-SG', { day: '2-digit', month: 'short' })}
                      </span>
                    </span>
                  </span>
                  <span className={`text-xs font-semibold ${statusColors[job.status]}`}>{job.status}</span>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>

      {draftJobs.length > 0 && (
        <section className="mt-4 overflow-hidden rounded-md bg-card">
          <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
            <Edit3 className="size-4 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Continue drafts</h2>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{draftJobs.length}</span>
          </div>
          <div className="divide-y divide-border/60">
            {draftJobs.slice(0, 3).map((draft: DraftPrintJob) => (
              <div
                key={draft.id}
                onClick={() => handleContinueDraft(draft)}
                className="group flex w-full cursor-pointer items-center gap-3 overflow-hidden px-5 py-3 transition-colors hover:bg-primary/5 sm:px-6"
              >
                <FileText className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1 overflow-hidden text-left">
                  <div className="truncate text-sm font-medium text-foreground">{draft.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {draft.pdf_info.num_pages} pages · {draft.settings.copies} copies
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                  onClick={(e) => handleDeleteDraft(draft.id, e)}
                  aria-label={`Remove ${draft.name} draft`}
                >
                  <X className="size-3 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <FileErrorDialog
        open={errorDialog.open}
        onOpenChange={(open) => setErrorDialog((current) => ({ ...current, open }))}
        title={errorDialog.title}
        message={errorDialog.message}
        technicalDetails={errorDialog.technicalDetails}
      />
    </PageScaffold>
  )
}
