import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { usePrinterStore } from '@/store/printer-store'
import { Document, Page, pdfjs } from 'react-pdf'
import {
  createPrintJob,
  submitPrintJob,
  getPrinters,
  generateBookletLayout,
} from '@/lib/printer-api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { toast } from 'sonner'
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from 'lucide-react'
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

export default function ModernPreviewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { sshConfig, printers, setPrinters, addPrintJob } = usePrinterStore()

  const filePath = location.state?.filePath
  const pdfInfo = location.state?.pdfInfo

  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
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

  useEffect(() => {
    if (!filePath) {
      navigate('/home')
      return
    }
    loadPrinters()
    loadPdfFile()
  }, [filePath, navigate])

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

  const loadPrinters = async () => {
    const result = await getPrinters()
    if (result.success && result.data) {
      setPrinters(result.data)
      const online = result.data.filter((p) => p.status === 'Online')
      if (online.length > 0) {
        const recommended = online.sort((a, b) => (b.paper_level || 0) - (a.paper_level || 0))[0]
        setRecommendedPrinter(recommended)
        setSelectedPrinter(recommended.queue_name)
      }
    }
  }

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
    try {
      const fileName = filePath.split('/').pop() || 'document.pdf'
      const createResult = await createPrintJob(fileName, filePath, selectedPrinter, settings)

      if (!createResult.success || !createResult.data) {
        throw new Error(createResult.error || 'Failed to create job')
      }

      const job = createResult.data
      addPrintJob(job)

      const submitResult = await submitPrintJob(job.id, sshConfig)

      if (submitResult.success) {
        toast.success('Print job submitted')
        navigate('/jobs')
      } else {
        toast.error(submitResult.error || 'Submission failed')
      }
    } catch (error) {
      toast.error('Error: ' + String(error))
    } finally {
      setSubmitting(false)
    }
  }, [filePath, selectedPrinter, sshConfig, settings, addPrintJob, navigate])

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
        {/* PDF viewer - left side */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-4xl mx-auto">
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
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
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
                {printers.map((p) => (
                  <option key={p.id} value={p.queue_name}>
                    {p.name} - {p.location.building}
                  </option>
                ))}
              </select>
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
    </div>
  )
}
