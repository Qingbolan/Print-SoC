import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePrinterStore } from '@/store/printer-store'
import { getAllPrintJobs, getPDFInfo } from '@/lib/printer-api'
import { safeDialogOpen } from '@/lib/tauri-utils'
import { toast } from 'sonner'
import { FileText, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AnimatedCard } from '@/components/magic/animated-card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { PrintJobStatus } from '@/types/printer'

const statusColors: Record<PrintJobStatus, string> = {
  Pending: 'text-gray-600 dark:text-gray-400',
  Uploading: 'text-blue-600 dark:text-blue-400',
  Queued: 'text-yellow-600 dark:text-yellow-400',
  Printing: 'text-purple-600 dark:text-purple-400',
  Completed: 'text-green-600 dark:text-green-400',
  Failed: 'text-red-600 dark:text-red-400',
  Cancelled: 'text-gray-600 dark:text-gray-400',
}

export default function ModernHomePageV2() {
  const navigate = useNavigate()
  const { isConnected, printJobs, setPrintJobs, setCurrentFile, sshConfig } = usePrinterStore()
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
  const connectionStatus = isConnected ? 'connected' : 'disconnected'

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
        navigate('/preview', { state: { filePath, pdfInfo: info.data } })
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

  const stats = useMemo(() => {
    const completed = printJobs.filter((j) => j.status === 'Completed').length
    const active = printJobs.filter((j) =>
      ['Pending', 'Uploading', 'Queued', 'Printing'].includes(j.status)
    ).length
    return { total: printJobs.length, completed, active }
  }, [printJobs])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border/50 backdrop-blur-sm bg-card/50">
        <div className="px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Print@SoC</h1>
            <p className="text-sm text-muted-foreground">NUS SoC Printing Service</p>
          </div>
          {connectionStatus === 'connected' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="w-2 h-2 bg-green-600 rounded-full" />
              Connected to {sshConfig?.host?.includes('stu') ? 'STU' : 'STF'}
            </div>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="border-b border-border/50 backdrop-blur-sm bg-card/30">
        <div className="px-8 py-3 flex items-center gap-8 text-sm">
          <div>
            <span className="text-muted-foreground">Total: </span>
            <span className="font-medium text-foreground">{stats.total}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Completed: </span>
            <span className="font-medium text-green-700 dark:text-green-400">{stats.completed}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Active: </span>
            <span className="font-medium text-blue-700 dark:text-blue-400">{stats.active}</span>
          </div>
        </div>
      </div>

      {/* Main content - Left/Right layout with full height */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left side - Upload area (占满宽度和高度) */}
        <div className="flex-1 p-8 overflow-y-auto">
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

        {/* Right side - Recent jobs table (占满宽度和高度) */}
        <div className="w-96 border-l border-border/50 backdrop-blur-sm bg-card/30 flex flex-col">
          <div className="px-6 py-4 border-b border-border/50">
            <h3 className="text-base font-semibold text-foreground">
              Recent Print Jobs
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto">
            {recentJobs.length === 0 ? (
              <div className="flex items-center justify-center h-full px-6">
                <div className="text-center text-muted-foreground">
                  <p className="text-sm">No print history yet</p>
                  <p className="text-xs mt-1">Start by uploading a PDF</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {recentJobs.map((job) => (
                  <Button
                    key={job.id}
                    onClick={() => navigate(`/jobs`)}
                    variant="ghost"
                    className="w-full h-auto px-6 py-4 justify-start rounded-none hover:bg-accent/80 fluent-transition"
                  >
                    <div className="flex items-start gap-3">
                      <FileText className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">
                          {job.name}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {new Date(job.created_at).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                        <div className={`text-xs font-medium mt-1 ${statusColors[job.status]}`}>
                          {job.status}
                        </div>
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            )}
          </div>

          {printJobs.length > 10 && (
            <div className="px-6 py-4 border-t border-border/50 text-center">
              <Button
                onClick={() => navigate('/jobs')}
                variant="ghost"
                size="sm"
                className="text-sm fluent-transition"
              >
                View all {printJobs.length} jobs →
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
              <AlertCircle className="w-5 h-5 text-red-600" />
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
