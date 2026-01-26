import { useState, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  FileText,
  Clock,
  Printer,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Copy,
  Layers,
  FileStack,
  Maximize2,
} from 'lucide-react'
import type { PrintJob, PrintJobStatus } from '@/types/printer'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

interface JobDetailDialogProps {
  job: PrintJob | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const statusConfig: Record<
  PrintJobStatus,
  { color: string; label: string }
> = {
  Pending: { color: 'bg-muted-foreground', label: 'Pending' },
  Uploading: { color: 'bg-accent', label: 'Uploading' },
  Queued: { color: 'bg-warning text-warning-foreground', label: 'Queued' },
  Printing: { color: 'bg-primary', label: 'Printing' },
  Completed: { color: 'bg-success', label: 'Completed' },
  Failed: { color: 'bg-destructive', label: 'Failed' },
  Cancelled: { color: 'bg-muted-foreground', label: 'Cancelled' },
}

export function JobDetailDialog({ job, open, onOpenChange }: JobDetailDialogProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    if (open && job?.file_path) {
      loadPdf(job.file_path)
    }
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl)
        setPdfUrl(null)
      }
    }
  }, [open, job?.file_path])

  useEffect(() => {
    setCurrentPage(1)
  }, [job?.id])

  const loadPdf = async (filePath: string) => {
    setLoading(true)
    setError(null)
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs')
      const data = await readFile(filePath)
      const blob = new Blob([data], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      setPdfUrl(url)
    } catch (err) {
      console.error('Failed to load PDF:', err)
      setError('Failed to load PDF file. It may have been moved or deleted.')
    } finally {
      setLoading(false)
    }
  }

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
  }

  if (!job) return null

  const settings = job.settings

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <DialogTitle className="flex items-center gap-2 text-lg">
                <FileText className="w-5 h-5 flex-shrink-0" />
                <span className="truncate">{job.name}</span>
              </DialogTitle>
              <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Printer className="w-4 h-4" />
                  {job.printer}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  {new Date(job.created_at).toLocaleString()}
                </span>
              </div>
            </div>
            <Badge
              variant="secondary"
              className={`${statusConfig[job.status].color} text-white flex-shrink-0`}
            >
              {statusConfig[job.status].label}
            </Badge>
          </div>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden" style={{ height: '60vh' }}>
          {/* PDF Preview */}
          <div className="flex-1 flex flex-col bg-muted/30 overflow-hidden">
            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Loading PDF...</p>
                </div>
              </div>
            ) : error ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">Cannot load preview</p>
                  <p className="text-sm mt-2">{error}</p>
                </div>
              </div>
            ) : pdfUrl ? (
              <>
                {/* Page navigation */}
                <div className="px-4 py-2 border-b border-border/50 bg-background flex items-center justify-center gap-2">
                  <Button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm font-medium px-3 min-w-[80px] text-center">
                    {currentPage} / {numPages}
                  </span>
                  <Button
                    onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                    disabled={currentPage >= numPages}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>

                {/* PDF viewer */}
                <div className="flex-1 overflow-auto flex items-center justify-center p-4">
                  <div className="shadow-lg rounded-lg overflow-hidden bg-white">
                    <Document
                      file={pdfUrl}
                      onLoadSuccess={onDocumentLoadSuccess}
                      loading={
                        <div className="flex items-center justify-center w-[400px] h-[500px]">
                          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                      }
                    >
                      <Page
                        pageNumber={currentPage}
                        width={400}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                      />
                    </Document>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          {/* Settings panel */}
          <div className="w-64 border-l border-border/50 bg-background overflow-y-auto">
            <div className="p-4 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Print Settings</h3>

              {/* Settings list */}
              <div className="space-y-3">
                <SettingItem
                  icon={<Copy className="w-4 h-4" />}
                  label="Copies"
                  value={settings.copies.toString()}
                />

                <SettingItem
                  icon={<Layers className="w-4 h-4" />}
                  label="Double-Sided"
                  value={settings.duplex === 'Simplex' ? 'Off' : 'On'}
                  highlight={settings.duplex !== 'Simplex'}
                />

                <SettingItem
                  icon={<Maximize2 className="w-4 h-4" />}
                  label="Paper Size"
                  value={settings.paper_size}
                />

                <SettingItem
                  icon={<FileText className="w-4 h-4" />}
                  label="Orientation"
                  value={settings.orientation}
                />

                <SettingItem
                  icon={<FileStack className="w-4 h-4" />}
                  label="Pages per Sheet"
                  value={settings.pages_per_sheet === 1 ? 'Standard' : `${settings.pages_per_sheet}-up`}
                  highlight={settings.pages_per_sheet > 1}
                />

                <SettingItem
                  icon={<FileText className="w-4 h-4" />}
                  label="Page Range"
                  value={formatPageRange(settings.page_range)}
                />
              </div>

              {/* Error message if any */}
              {job.error && (
                <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm font-medium text-destructive">Error</p>
                  <p className="text-xs text-destructive/80 mt-1">{job.error}</p>
                </div>
              )}

              {/* Job ID */}
              <div className="mt-4 pt-4 border-t border-border/50">
                <p className="text-xs text-muted-foreground">
                  Job ID: <span className="font-mono">{job.id.slice(0, 8)}</span>
                </p>
                {job.lpq_job_id && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Queue ID: <span className="font-mono">{job.lpq_job_id}</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SettingItem({
  icon,
  label,
  value,
  highlight = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <span className={cn(
        "text-sm font-medium",
        highlight ? "text-primary" : "text-foreground"
      )}>
        {value}
      </span>
    </div>
  )
}

function formatPageRange(pageRange: PrintJob['settings']['page_range']): string {
  switch (pageRange.type) {
    case 'All':
      return 'All'
    case 'Range':
      return `${pageRange.start}-${pageRange.end}`
    case 'Selection':
      const pages = pageRange.pages || []
      if (pages.length <= 3) {
        return pages.join(', ')
      }
      return `${pages.slice(0, 2).join(', ')}... (${pages.length})`
    default:
      return 'All'
  }
}
