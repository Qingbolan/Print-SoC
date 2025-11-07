import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { usePrinterStore } from '@/store/printer-store'
import { PRINTERS } from '@/data/printers'
import { Document, Page, pdfjs } from 'react-pdf'
import {
  createPrintJob,
  submitPrintJob,
  generateBookletLayout,
} from '@/lib/printer-api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  GripVertical,
  RotateCcw,
} from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { PrintSettings, BookletLayout, Printer, PageRange } from '@/types/printer'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// Use local worker file instead of CDN for Tauri app
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

// Sortable thumbnail component
function SortableThumbnail({
  page,
  isActive,
  pdfUrl,
  onClick,
  displayOrder
}: {
  page: number
  isActive: boolean
  pdfUrl: string
  onClick: () => void
  displayOrder: number
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="relative">
      <button
        onClick={onClick}
        className={cn(
          'w-full rounded-lg border-2 transition-all overflow-hidden relative',
          isActive
            ? 'border-primary ring-2 ring-primary/20'
            : 'border-border/50 hover:border-border'
        )}
      >
        <div className="relative">
          <Document file={pdfUrl}>
            <Page
              pageNumber={page}
              width={160}
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          </Document>
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs py-1 px-2 flex items-center justify-between">
            <span className="flex-1 text-center">Page {page}</span>
          </div>
          {displayOrder !== page && (
            <div className="absolute top-1 right-1 bg-orange-500 text-white text-xs font-bold px-1.5 py-0.5 rounded">
              #{displayOrder}
            </div>
          )}
        </div>
      </button>
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-1 left-1 bg-black/50 hover:bg-black/70 text-white rounded p-1 cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="w-4 h-4" />
      </div>
    </div>
  )
}

export default function ModernPreviewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { sshConfig, printerGroups, setPrinters, addPrintJob } = usePrinterStore()

  // Get all printers from groups
  const printers = printerGroups.flatMap(g => g.printers)

  const filePath = location.state?.filePath
  const pdfInfo = location.state?.pdfInfo

  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageOrder, setPageOrder] = useState<number[]>([])
  const [bookletLayout, setBookletLayout] = useState<BookletLayout | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [recommendedPrinter, setRecommendedPrinter] = useState<Printer | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [loadingPdf, setLoadingPdf] = useState(false)
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
  const [printDialog, setPrintDialog] = useState<{
    open: boolean
    status: 'submitting' | 'success' | 'error'
    jobName?: string
    printer?: string
    error?: string
  }>({
    open: false,
    status: 'submitting',
  })

  const [settings, setSettings] = useState<PrintSettings>({
    copies: 1,
    duplex: 'DuplexLongEdge',
    orientation: 'Portrait',
    page_range: { type: 'All' },
    pages_per_sheet: 1,
    booklet: false,
    paper_size: 'A4',
  })

  // Helpers for Page Range editing UI
  const [rangeStart, setRangeStart] = useState<number>(1)
  const [rangeEnd, setRangeEnd] = useState<number>(1)
  const [selectionText, setSelectionText] = useState<string>('')

  // keep page range editors in sync with PDF page count
  useEffect(() => {
    if (numPages && settings.page_range.type === 'Range') {
      setRangeStart((s) => Math.max(1, Math.min(s, numPages)))
      setRangeEnd((e) => Math.max(1, Math.min(Math.max(e, rangeStart), numPages)))
    }
  }, [numPages])

  const [selectedPrinter, setSelectedPrinter] = useState('')

  // Initialize page order when PDF loads
  useEffect(() => {
    if (numPages > 0) {
      setPageOrder(Array.from({ length: numPages }, (_, i) => i + 1))
    }
  }, [numPages])

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      setPageOrder((items) => {
        const oldIndex = items.indexOf(active.id as number)
        const newIndex = items.indexOf(over.id as number)
        return arrayMove(items, oldIndex, newIndex)
      })
      toast.success('Page order updated')
    }
  }

  const resetPageOrder = () => {
    setPageOrder(Array.from({ length: numPages }, (_, i) => i + 1))
    toast.success('Page order reset to default')
  }

  useEffect(() => {
    if (!filePath) {
      navigate('/home')
      return
    }
    // Initialize printers from PRINTERS data
    setPrinters(PRINTERS)
    loadPdfFile()
  }, [filePath, navigate, setPrinters])

  const loadPdfFile = async () => {
    if (!filePath) return

    setLoadingPdf(true)
    try {
      console.log('Loading PDF file:', filePath)

      // Use Tauri's file system to read the file
      const { readFile } = await import('@tauri-apps/plugin-fs')
      const data = await readFile(filePath)

      // Create a Blob from the data
      const blob = new Blob([data], { type: 'application/pdf' })

      // Create an object URL for the blob
      const url = URL.createObjectURL(blob)

      // Clean up previous URL if exists
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl)
      }

      setPdfUrl(url)
      console.log('PDF loaded successfully:', url)
    } catch (error) {
      console.error('Error loading PDF file:', error)

      const errorMsg = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : undefined

      let details = `Error: ${errorMsg}\n`
      details += `File Path: ${filePath}\n\n`

      if (errorStack) {
        details += `Stack Trace:\n${errorStack}`
      }

      setErrorDialog({
        open: true,
        title: 'Failed to Load PDF File',
        message: 'Could not read the PDF file from disk. Please check if the file exists and you have permission to access it.',
        technicalDetails: details,
      })
    } finally {
      setLoadingPdf(false)
    }
  }

  // Cleanup: revoke URL when component unmounts
  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl)
      }
    }
  }, [pdfUrl])

  useEffect(() => {
    if (settings.booklet && pdfInfo) {
      loadBookletLayout()
    }
  }, [settings.booklet, pdfInfo])

  // Set recommended printer when printers are loaded
  useEffect(() => {
    if (printers.length > 0 && !selectedPrinter) {
      const online = printers.filter((p) => p.status === 'Online')
      if (online.length > 0) {
        const recommended = online.sort((a, b) => (b.paper_level || 0) - (a.paper_level || 0))[0]
        setRecommendedPrinter(recommended)
        setSelectedPrinter(recommended.queue_name)
      } else {
        // If no online printers, select the first one
        setSelectedPrinter(printers[0].queue_name)
      }
    }
  }, [printers, selectedPrinter])

  const loadBookletLayout = async () => {
    if (!pdfInfo) return
    const result = await generateBookletLayout(pdfInfo.num_pages)
    if (result.success && result.data) {
      setBookletLayout(result.data)
    }
  }

  const handlePDFLoadError = useCallback((error: Error) => {
    console.error('PDF load error:', error)
    console.error('Error name:', error.name)
    console.error('Error message:', error.message)
    console.error('Error stack:', error.stack)
    console.error('File path:', filePath)

    // Extract detailed error information
    const errorMsg = error.message || String(error)
    const errorName = error.name || 'Unknown Error'
    const errorStack = error.stack || undefined

    // Build detailed error message
    let details = `Error Type: ${errorName}\n`
    details += `Error Message: ${errorMsg}\n`
    details += `File Path: ${filePath || 'Not specified'}\n\n`

    if (errorStack) {
      details += `Stack Trace:\n${errorStack}`
    }

    // Show detailed error dialog
    setErrorDialog({
      open: true,
      title: 'Failed to Load PDF',
      message: 'The PDF file could not be loaded in the preview. This could be due to a corrupted file, unsupported PDF version, or file access issues.',
      technicalDetails: details,
    })
  }, [filePath])

  const estimate = useMemo(() => {
    if (!pdfInfo) return { cost: 0, paperSaved: 0 }

    let sheetsPerCopy = pdfInfo.num_pages
    if (settings.duplex !== 'Simplex') sheetsPerCopy = Math.ceil(pdfInfo.num_pages / 2)
    if (settings.pages_per_sheet > 1)
      sheetsPerCopy = Math.ceil(pdfInfo.num_pages / settings.pages_per_sheet)
    if (settings.booklet) sheetsPerCopy = Math.ceil(pdfInfo.num_pages / 4)

    const totalSheets = sheetsPerCopy * settings.copies
    const cost = totalSheets * 0.05
    const paperSaved = pdfInfo.num_pages * settings.copies - totalSheets

    return { cost, paperSaved }
  }, [pdfInfo, settings.duplex, settings.pages_per_sheet, settings.booklet, settings.copies])

  const handleOptimize = useCallback(() => {
    if (!pdfInfo) return

    if (pdfInfo.num_pages >= 20) {
      setSettings((prev) => ({ ...prev, duplex: 'DuplexLongEdge', pages_per_sheet: 2 }))
      toast.success('Optimized for paper saving')
    } else if (pdfInfo.num_pages % 4 === 0) {
      setSettings((prev) => ({ ...prev, booklet: true, duplex: 'DuplexLongEdge' }))
      toast.success('Booklet mode enabled')
    }
  }, [pdfInfo])

  const handleSubmit = useCallback(async () => {
    if (!filePath || !selectedPrinter || !sshConfig) return

    setSubmitting(true)
    const fileName = filePath.split('/').pop() || 'document.pdf'

    // Show submitting dialog
    setPrintDialog({
      open: true,
      status: 'submitting',
      jobName: fileName,
      printer: selectedPrinter,
    })

    try {
      // Check if page order has been customized
      const isCustomOrder = pageOrder.some((page, index) => page !== index + 1)

      // If custom order, override page_range setting
      const finalSettings = isCustomOrder
        ? { ...settings, page_range: { type: 'Selection' as const, pages: pageOrder } }
        : settings

      const createResult = await createPrintJob(fileName, filePath, selectedPrinter, finalSettings)

      if (!createResult.success || !createResult.data) {
        throw new Error(createResult.error || 'Failed to create job')
      }

      const job = createResult.data
      addPrintJob(job)

      const submitResult = await submitPrintJob(job.id, sshConfig)

      if (submitResult.success) {
        // Show success dialog
        setPrintDialog({
          open: true,
          status: 'success',
          jobName: fileName,
          printer: selectedPrinter,
        })

        // Auto close after 3 seconds and navigate
        setTimeout(() => {
          setPrintDialog({ open: false, status: 'success' })
          navigate('/jobs')
        }, 3000)
      } else {
        // Show error dialog
        setPrintDialog({
          open: true,
          status: 'error',
          jobName: fileName,
          printer: selectedPrinter,
          error: submitResult.error || 'Submission failed',
        })
      }
    } catch (error) {
      // Show error dialog
      setPrintDialog({
        open: true,
        status: 'error',
        jobName: fileName,
        printer: selectedPrinter,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSubmitting(false)
    }
  }, [filePath, selectedPrinter, sshConfig, settings, pageOrder, addPrintJob, navigate])

  return (
    <div className="h-full flex flex-col">
      {/* Minimal toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/50 backdrop-blur-sm bg-card/50">
        <Button
          onClick={() => navigate('/home')}
          variant="ghost"
          size="sm"
          className="fluent-transition"
        >
          ← Back
        </Button>

        <div className="flex items-center gap-6 text-sm text-foreground">
          {pdfInfo && (
            <>
              <span>{pdfInfo.num_pages} pages</span>
              {estimate.paperSaved > 0 && (
                <span className="text-green-600 dark:text-green-400">{estimate.paperSaved} sheets saved</span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Thumbnail sidebar - left */}
        {numPages > 0 && pdfUrl && pageOrder.length > 0 && (
          <div className="w-48 border-r border-border/50 overflow-y-auto p-3 space-y-2">
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="text-xs font-semibold text-muted-foreground">
                Pages ({numPages})
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetPageOrder}
                className="h-6 px-2 text-xs"
                title="Reset page order"
              >
                <RotateCcw className="w-3 h-3" />
              </Button>
            </div>
            <div className="text-xs text-muted-foreground mb-2 px-1">
              Drag to reorder
            </div>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={pageOrder}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {pageOrder.map((page, index) => (
                    <SortableThumbnail
                      key={page}
                      page={page}
                      isActive={pageNumber === page}
                      pdfUrl={pdfUrl}
                      onClick={() => setPageNumber(page)}
                      displayOrder={index + 1}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}

        {/* PDF viewer - center */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-4xl mx-auto">
            {/* Preview mode indicator */}
            {numPages > 0 && pageOrder.some((page, index) => page !== index + 1) && (
              <div className="mb-4 p-3 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg">
                <div className="text-sm text-orange-900 dark:text-orange-100 flex items-center justify-between">
                  <span>Custom page order: {pageOrder.join(', ')}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetPageOrder}
                    className="h-6 px-2 text-xs ml-2"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Reset
                  </Button>
                </div>
              </div>
            )}

            {numPages > 0 && settings.pages_per_sheet > 1 && (
              <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                <div className="text-sm text-blue-900 dark:text-blue-100">
                  Preview shows single pages. Print output will be {settings.pages_per_sheet}-up layout.
                </div>
              </div>
            )}

            {settings.booklet && (
              <div className="mb-4 p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg">
                <div className="text-sm text-purple-900 dark:text-purple-100">
                  Preview shows single pages. Print output will be booklet format.
                </div>
              </div>
            )}

            {settings.duplex !== 'Simplex' && (
              <div className="mb-4 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
                <div className="text-sm text-green-900 dark:text-green-100">
                  Double-sided printing enabled. Queue: {selectedPrinter?.replace('-sx', '')}
                </div>
              </div>
            )}

            <div className="backdrop-blur-sm bg-card/40 shadow-lg rounded-xl border border-border/50">
              {loadingPdf ? (
                <div className="flex items-center justify-center p-16">
                  <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">Loading PDF file...</p>
                  </div>
                </div>
              ) : pdfUrl ? (
                <Document
                  file={pdfUrl}
                  onLoadSuccess={({ numPages }: { numPages: number }) => setNumPages(numPages)}
                  onLoadError={handlePDFLoadError}
                  loading={
                    <div className="flex items-center justify-center p-16">
                      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    </div>
                  }
                  error={
                    <div className="text-center p-16 text-destructive">
                      <AlertCircle className="w-12 h-12 mx-auto mb-4" />
                      <p className="mb-2 font-semibold">Failed to load PDF</p>
                      <p className="text-sm">See error details in the dialog</p>
                    </div>
                  }
                >
                  <Page
                    pageNumber={pageNumber}
                    width={750}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                    loading={
                      <div className="flex items-center justify-center p-16">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      </div>
                    }
                  />
                </Document>
              ) : (
                <div className="flex items-center justify-center p-16">
                  <div className="text-center text-muted-foreground">
                    <p className="text-sm">No PDF file loaded</p>
                    <p className="text-xs mt-2">Please select a file to preview</p>
                  </div>
                </div>
              )}
            </div>

            {numPages > 0 && (
              <div className="flex items-center justify-center gap-4 mt-6">
                <Button
                  onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                  disabled={pageNumber <= 1}
                  variant="ghost"
                  size="icon"
                  className="fluent-transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-foreground">
                  Page {pageNumber} of {numPages}
                </span>
                <Button
                  onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
                  disabled={pageNumber >= numPages}
                  variant="ghost"
                  size="icon"
                  className="fluent-transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Settings panel - right sidebar */}
        <div className="w-80 border-l border-border/50 backdrop-blur-sm bg-card/30 overflow-y-auto">
          <div className="p-6 space-y-8">
            {/* Quick optimize */}
            <Button
              onClick={handleOptimize}
              disabled={!pdfInfo}
              className="w-full rounded-xl fluent-shadow-xs hover:fluent-shadow-sm fluent-transition"
            >
              Optimize Settings
            </Button>

            {/* Print options */}
            <div>
              <h3 className="text-base font-semibold text-foreground mb-4">Print Options</h3>

              {/* Copies */}
              <div className="mb-6">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Copies</label>
                  <span className="text-sm font-medium text-foreground">{settings.copies}</span>
                </div>
                <Slider
                  value={[settings.copies]}
                  onValueChange={([val]) => setSettings({ ...settings, copies: val })}
                  min={1}
                  max={10}
                  step={1}
                  className="w-full"
                />
              </div>

              {/* Double-sided */}
              <div className="flex justify-between items-center py-3 border-t border-border">
                <div>
                  <div className="text-sm font-medium text-foreground">Double-Sided</div>
                  <div className="text-xs text-muted-foreground">Save 50% paper</div>
                </div>
                <Switch
                  checked={settings.duplex !== 'Simplex'}
                  onCheckedChange={(checked) =>
                    setSettings({ ...settings, duplex: checked ? 'DuplexLongEdge' : 'Simplex' })
                  }
                />
              </div>

              {/* Paper size */}
              <div className="flex justify-between items-center py-3 border-t border-border">
                <div>
                  <div className="text-sm font-medium text-foreground">Paper Size</div>
                  <div className="text-xs text-muted-foreground">
                    {selectedPrinter
                      ? printers.find((p) => p.queue_name === selectedPrinter)?.supported_paper_sizes.join(', ') || 'A4'
                      : 'A4, A3'}
                  </div>
                </div>
                <select
                  className="px-2 py-1 text-sm border border-border rounded bg-background text-foreground"
                  value={settings.paper_size}
                  onChange={(e) => setSettings({ ...settings, paper_size: e.target.value as PrintSettings['paper_size'] })}
                >
                  {(selectedPrinter
                    ? (printers.find((p) => p.queue_name === selectedPrinter)?.supported_paper_sizes || ['A4'])
                    : (['A4', 'A3'] as const)
                  ).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Orientation */}
              <div className="flex justify-between items-center py-3 border-t border-border">
                <div>
                  <div className="text-sm font-medium text-foreground">Orientation</div>
                  <div className="text-xs text-muted-foreground">Portrait or Landscape</div>
                </div>
                <select
                  className="px-2 py-1 text-sm border border-border rounded bg-background text-foreground"
                  value={settings.orientation}
                  onChange={(e) => setSettings({ ...settings, orientation: e.target.value as PrintSettings['orientation'] })}
                >
                  {(['Portrait','Landscape'] as const).map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>

              {/* Booklet */}
              <div className="flex justify-between items-center py-3 border-t border-border">
                <div>
                  <div className="text-sm font-medium text-foreground">Booklet Mode</div>
                  <div className="text-xs text-muted-foreground">Fold-ready layout</div>
                </div>
                <Switch
                  checked={settings.booklet}
                  onCheckedChange={(checked) => setSettings({ ...settings, booklet: checked })}
                />
              </div>

              {/* Pages per sheet */}
              <div className="flex justify-between items-center py-3 border-t border-border">
                <div>
                  <div className="text-sm font-medium text-foreground">Pages per Sheet</div>
                  <div className="text-xs text-muted-foreground">
                    {settings.pages_per_sheet === 1 ? 'Standard' : `${settings.pages_per_sheet}-up`}
                  </div>
                </div>
                <select
                  className="px-2 py-1 text-sm border border-border rounded bg-background text-foreground"
                  value={settings.pages_per_sheet}
                  onChange={(e) =>
                    setSettings({ ...settings, pages_per_sheet: parseInt(e.target.value) })
                  }
                >
                  {[1, 2, 4, 6, 9].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              {/* Page range */}
              <div className="py-3 border-t border-border space-y-2">
                <div className="text-sm font-medium text-foreground">Page Range</div>
                <select
                  className="w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground"
                  value={settings.page_range.type}
                  onChange={(e) => {
                    const t = e.target.value as PageRange['type']
                    if (t === 'All') setSettings({ ...settings, page_range: { type: 'All' } })
                    else if (t === 'Range') setSettings({ ...settings, page_range: { type: 'Range', start: 1, end: Math.max(1, numPages || 1) } })
                    else setSettings({ ...settings, page_range: { type: 'Selection', pages: [] } })
                  }}
                >
                  <option value="All">All</option>
                  <option value="Range">Range</option>
                  <option value="Selection">Selection</option>
                </select>

                {settings.page_range.type === 'Range' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={numPages || 9999}
                      value={rangeStart}
                      onChange={(e) => setRangeStart(Math.max(1, Math.min(Number(e.target.value || 1), numPages || 9999)))}
                      onBlur={() => {
                        const start = rangeStart
                        const end = Math.max(start, rangeEnd)
                        setRangeEnd(end)
                        setSettings({ ...settings, page_range: { type: 'Range', start, end } })
                      }}
                      className="w-20 px-2 py-1 text-sm border border-border rounded bg-background text-foreground"
                    />
                    <span className="text-muted-foreground text-sm">to</span>
                    <input
                      type="number"
                      min={1}
                      max={numPages || 9999}
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(Math.max(1, Math.min(Number(e.target.value || 1), numPages || 9999)))}
                      onBlur={() => {
                        const start = Math.min(rangeStart, rangeEnd)
                        const end = Math.max(rangeStart, rangeEnd)
                        setRangeStart(start)
                        setRangeEnd(end)
                        setSettings({ ...settings, page_range: { type: 'Range', start, end } })
                      }}
                      className="w-20 px-2 py-1 text-sm border border-border rounded bg-background text-foreground"
                    />
                  </div>
                )}

                {settings.page_range.type === 'Selection' && (
                  <div className="space-y-1">
                    <input
                      type="text"
                      placeholder="e.g. 1,3,5"
                      value={selectionText}
                      onChange={(e) => setSelectionText(e.target.value)}
                      onBlur={() => {
                        const pages = selectionText
                          .split(',')
                          .map((s) => Number(s.trim()))
                          .filter((n) => Number.isFinite(n) && n >= 1 && (!numPages || n <= numPages))
                        setSettings({ ...settings, page_range: { type: 'Selection', pages } })
                      }}
                      className="w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground"
                    />
                    <div className="text-xs text-muted-foreground">Comma-separated page numbers</div>
                  </div>
                )}
              </div>
            </div>

            {/* Printer selection */}
            <div>
              <h3 className="text-base font-semibold text-foreground mb-4">Printer</h3>

              {recommendedPrinter && (
                <div className="mb-4 p-3 bg-muted/50 border border-border rounded-lg">
                  <div className="text-xs text-muted-foreground mb-1">Recommended</div>
                  <div className="text-sm font-medium text-foreground">{recommendedPrinter.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {recommendedPrinter.location.building} - {recommendedPrinter.location.room}
                  </div>
                </div>
              )}

              <select
                className="w-full px-3 py-2 text-sm border border-border rounded bg-background text-foreground"
                value={selectedPrinter}
                onChange={(e) => setSelectedPrinter(e.target.value)}
              >
                {printerGroups.map((group) => (
                  <optgroup key={group.id} label={group.display_name}>
                    {group.printers.map((p) => (
                      <option key={p.id} value={p.queue_name}>
                        {p.name} {p.variant && `(${p.variant})`}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {printers.length > 0 && selectedPrinter && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {printers.find(p => p.queue_name === selectedPrinter)?.location.building} -
                  {' '}{printers.find(p => p.queue_name === selectedPrinter)?.location.room}
                </div>
              )}
            </div>

            {/* Submit button */}
            <Button
              onClick={handleSubmit}
              disabled={!selectedPrinter || submitting}
              className="w-full px-4 py-3 rounded-xl bg-green-600 hover:bg-green-700 fluent-shadow-sm hover:fluent-shadow fluent-transition"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </span>
              ) : (
                'Print Now'
              )}
            </Button>
          </div>
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

      {/* Print Status Dialog */}
      <AlertDialog
        open={printDialog.open}
        onOpenChange={(open) => {
          if (printDialog.status !== 'submitting') {
            setPrintDialog({ ...printDialog, open })
          }
        }}
      >
        <AlertDialogContent>
          {printDialog.status === 'submitting' && (
            <>
              <AlertDialogHeader>
                <div className="flex items-center gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <AlertDialogTitle>Submitting Print Job</AlertDialogTitle>
                </div>
                <AlertDialogDescription>
                  Uploading file and queuing print job...
                </AlertDialogDescription>
                <div className="text-left space-y-2 pt-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Document:</span>
                    <span className="font-medium">{printDialog.jobName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Printer:</span>
                    <span className="font-medium">{printDialog.printer}</span>
                  </div>
                </div>
              </AlertDialogHeader>
            </>
          )}

          {printDialog.status === 'success' && (
            <>
              <AlertDialogHeader>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <AlertDialogTitle className="text-green-700 dark:text-green-400">
                    Print Job Submitted Successfully
                  </AlertDialogTitle>
                </div>
                <AlertDialogDescription>
                  Your document has been sent to the printer queue. You can monitor the progress in the Jobs page.
                </AlertDialogDescription>
                <div className="text-left space-y-3 pt-4">
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Document:</span>
                      <span className="font-medium text-foreground">{printDialog.jobName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Printer:</span>
                      <span className="font-medium text-foreground">{printDialog.printer}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Status:</span>
                      <span className="font-medium text-green-600 dark:text-green-400">Queued</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Redirecting to Jobs page in 3 seconds...
                  </p>
                </div>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onClick={() => {
                  setPrintDialog({ open: false, status: 'success' })
                  navigate('/jobs')
                }}>
                  View Jobs
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}

          {printDialog.status === 'error' && (
            <>
              <AlertDialogHeader>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                    <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
                  </div>
                  <AlertDialogTitle className="text-red-700 dark:text-red-400">
                    Print Job Failed
                  </AlertDialogTitle>
                </div>
                <AlertDialogDescription>
                  An error occurred while submitting your print job. Please review the details below and try again.
                </AlertDialogDescription>
                <div className="text-left space-y-3 pt-4">
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Document:</span>
                      <span className="font-medium text-foreground">{printDialog.jobName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Printer:</span>
                      <span className="font-medium text-foreground">{printDialog.printer}</span>
                    </div>
                  </div>
                  <div className="bg-muted rounded-lg p-3">
                    <div className="text-sm font-medium text-foreground mb-1">Error:</div>
                    <div className="text-sm text-red-600 dark:text-red-400">{printDialog.error}</div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <strong>Possible solutions:</strong>
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      <li>Check if you're connected to SSH</li>
                      <li>Verify the printer is online and available</li>
                      <li>Make sure the file is not corrupted</li>
                      <li>Try again or contact support</li>
                    </ul>
                  </div>
                </div>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onClick={() => setPrintDialog({ open: false, status: 'error' })}>
                  Close
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
