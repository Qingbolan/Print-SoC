import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { usePrinterStore } from '@/store/printer-store'
import { PRINTERS } from '@/data/printers'
import { Document, Page, pdfjs } from 'react-pdf'
import {
  createPrintJob,
  submitPrintJob,
  getPDFInfo,
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
  X,
  FileText,
  Upload,
  Printer,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Move,
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
import type { PrintSettings, Printer as PrinterType, PageRange, PDFInfo } from '@/types/printer'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// Use local worker file instead of CDN for Tauri app
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

interface QueuedFile {
  id: string
  path: string
  name: string
  pdfUrl: string | null
  pdfInfo: PDFInfo | null
  loading: boolean
  error: string | null
}

export default function ModernPreviewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { sshConfig, printerGroups, setPrinters, addPrintJob } = usePrinterStore()

  // Get all printers from groups
  const printers = printerGroups.flatMap(g => g.printers)

  const initialFilePath = location.state?.filePath
  const initialPdfInfo = location.state?.pdfInfo

  // File queue management
  const [fileQueue, setFileQueue] = useState<QueuedFile[]>([])
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Current file state
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [recommendedPrinter, setRecommendedPrinter] = useState<PrinterType | null>(null)
  const [pageWidth, setPageWidth] = useState<number | undefined>(undefined)
  const [pageHeight, setPageHeight] = useState<number | undefined>(undefined)

  // Zoom and pan controls
  const [zoomLevel, setZoomLevel] = useState(1.0)
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })

  // Ref for PDF container to calculate optimal size
  const pdfContainerRef = useRef<HTMLDivElement>(null)

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

  const [selectedPrinter, setSelectedPrinter] = useState('')

  // Get selected file
  const selectedFile = useMemo(() =>
    fileQueue.find(f => f.id === selectedFileId),
    [fileQueue, selectedFileId]
  )

  // Calculate which pages will be printed based on page_range
  const pagesToPrint = useMemo(() => {
    if (!selectedFile?.pdfInfo) return new Set<number>()

    const totalPages = selectedFile.pdfInfo.num_pages
    const pages = new Set<number>()

    switch (settings.page_range.type) {
      case 'All':
        for (let i = 1; i <= totalPages; i++) {
          pages.add(i)
        }
        break
      case 'Range':
        const start = Math.max(1, settings.page_range.start || 1)
        const end = Math.min(totalPages, settings.page_range.end || totalPages)
        for (let i = start; i <= end; i++) {
          pages.add(i)
        }
        break
      case 'Selection':
        (settings.page_range.pages || []).forEach(p => {
          if (p >= 1 && p <= totalPages) {
            pages.add(p)
          }
        })
        break
    }

    return pages
  }, [selectedFile, settings.page_range])

  // Calculate effective page count after n-up
  const effectivePageCount = useMemo(() => {
    const pagesCount = pagesToPrint.size
    if (settings.pages_per_sheet > 1) {
      return Math.ceil(pagesCount / settings.pages_per_sheet)
    }
    return pagesCount
  }, [pagesToPrint, settings.pages_per_sheet])

  // Initialize with file from location state
  useEffect(() => {
    if (initialFilePath) {
      addFileToQueue(initialFilePath, initialPdfInfo)
    }
    setPrinters(PRINTERS)
  }, [])

  // Reset page number when switching files
  useEffect(() => {
    if (selectedFileId) {
      setPageNumber(1)
    }
  }, [selectedFileId])

  // Auto-navigate to first printable page if current page is not in range
  useEffect(() => {
    if (pagesToPrint.size > 0 && !pagesToPrint.has(pageNumber)) {
      const firstPage = Math.min(...Array.from(pagesToPrint))
      setPageNumber(firstPage)
    }
  }, [pagesToPrint, pageNumber])

  // Reset page dimensions when file changes
  useEffect(() => {
    setPageWidth(undefined)
    setPageHeight(undefined)
  }, [selectedFile, pageNumber])

  // Reset zoom and pan when file or page changes
  useEffect(() => {
    setZoomLevel(1.0)
    setPanPosition({ x: 0, y: 0 })
  }, [selectedFile, pageNumber])

  // Zoom control functions
  const handleZoomIn = useCallback(() => {
    setZoomLevel(prev => Math.min(prev + 0.25, 3.0))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoomLevel(prev => Math.max(prev - 0.25, 0.5))
  }, [])

  const handleResetView = useCallback(() => {
    setZoomLevel(1.0)
    setPanPosition({ x: 0, y: 0 })
  }, [])

  // Pan control functions
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoomLevel > 1.0) {
      setIsPanning(true)
      setPanStart({ x: e.clientX - panPosition.x, y: e.clientY - panPosition.y })
    }
  }, [zoomLevel, panPosition])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setPanPosition({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      })
    }
  }, [isPanning, panStart])

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsPanning(false)
  }, [])

  // Add file to queue
  const addFileToQueue = async (filePath: string, pdfInfo: PDFInfo | null = null) => {
    const fileName = filePath.split('/').pop() || 'document.pdf'
    const fileId = `${Date.now()}-${Math.random()}`

    const newFile: QueuedFile = {
      id: fileId,
      path: filePath,
      name: fileName,
      pdfUrl: null,
      pdfInfo: pdfInfo,
      loading: true,
      error: null,
    }

    setFileQueue(prev => [...prev, newFile])
    if (!selectedFileId) {
      setSelectedFileId(fileId)
    }

    // Load PDF
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs')
      const data = await readFile(filePath)
      const blob = new Blob([data], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)

      // Get PDF info if not provided
      let info = pdfInfo
      if (!info) {
        const infoResult = await getPDFInfo(filePath)
        if (infoResult.success && infoResult.data) {
          info = infoResult.data
        }
      }

      setFileQueue(prev => prev.map(f =>
        f.id === fileId
          ? { ...f, pdfUrl: url, pdfInfo: info, loading: false }
          : f
      ))
    } catch (error) {
      console.error('Error loading PDF:', error)
      setFileQueue(prev => prev.map(f =>
        f.id === fileId
          ? { ...f, error: 'Failed to load PDF', loading: false }
          : f
      ))
    }
  }

  // Remove file from queue
  const removeFile = (fileId: string) => {
    const file = fileQueue.find(f => f.id === fileId)
    if (file?.pdfUrl) {
      URL.revokeObjectURL(file.pdfUrl)
    }

    setFileQueue(prev => prev.filter(f => f.id !== fileId))

    if (selectedFileId === fileId) {
      const remaining = fileQueue.filter(f => f.id !== fileId)
      setSelectedFileId(remaining.length > 0 ? remaining[0].id : null)
    }
  }

  // Handle file drop
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    const pdfFiles = files.filter(f => f.name.toLowerCase().endsWith('.pdf'))

    if (pdfFiles.length === 0) {
      toast.error('Please drop PDF files only')
      return
    }

    for (const file of pdfFiles) {
      // Use Tauri dialog to get file path
      const { open } = await import('@tauri-apps/plugin-dialog')
      const filePath = await open({
        multiple: false,
        filters: [{
          name: 'PDF',
          extensions: ['pdf']
        }]
      })

      if (filePath) {
        await addFileToQueue(filePath as string)
      }
    }
  }

  // Handle file selection
  const handleFileSelect = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const filePaths = await open({
      multiple: true,
      filters: [{
        name: 'PDF',
        extensions: ['pdf']
      }]
    })

    if (filePaths) {
      const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
      for (const path of paths) {
        await addFileToQueue(path)
      }
    }
  }

  // Set recommended printer
  useEffect(() => {
    if (printers.length > 0 && !selectedPrinter) {
      const online = printers.filter((p) => p.status === 'Online')
      if (online.length > 0) {
        const recommended = online.sort((a, b) => (b.paper_level || 0) - (a.paper_level || 0))[0]
        setRecommendedPrinter(recommended)
        setSelectedPrinter(recommended.queue_name)
      } else {
        setSelectedPrinter(printers[0]?.queue_name || '')
      }
    }
  }, [printers, selectedPrinter])

  const handlePDFLoadError = useCallback((error: Error) => {
    console.error('PDF load error:', error)
    setErrorDialog({
      open: true,
      title: 'Failed to Load PDF',
      message: 'The PDF file could not be loaded in the preview.',
      technicalDetails: error.stack,
    })
  }, [])

  const handlePageLoadSuccess = useCallback((page: any) => {
    if (!pdfContainerRef.current) return

    const viewport = page.getViewport({ scale: 1 })
    const containerWidth = pdfContainerRef.current.clientWidth
    const containerHeight = pdfContainerRef.current.clientHeight

    // Calculate scale to fit both width and height
    const scaleWidth = (containerWidth * 0.95) / viewport.width
    const scaleHeight = (containerHeight * 0.95) / viewport.height
    const scale = Math.min(scaleWidth, scaleHeight, 2.0) // Cap at 2x

    setPageWidth(viewport.width * scale)
    setPageHeight(viewport.height * scale)
  }, [])

  const estimate = useMemo(() => {
    if (!selectedFile?.pdfInfo) return { cost: 0, paperSaved: 0 }

    let sheetsPerCopy = selectedFile.pdfInfo.num_pages
    if (settings.duplex !== 'Simplex') sheetsPerCopy = Math.ceil(selectedFile.pdfInfo.num_pages / 2)
    if (settings.pages_per_sheet > 1)
      sheetsPerCopy = Math.ceil(selectedFile.pdfInfo.num_pages / settings.pages_per_sheet)
    if (settings.booklet) sheetsPerCopy = Math.ceil(selectedFile.pdfInfo.num_pages / 4)

    const totalSheets = sheetsPerCopy * settings.copies
    const cost = totalSheets * 0.05
    const paperSaved = selectedFile.pdfInfo.num_pages * settings.copies - totalSheets

    return { cost, paperSaved }
  }, [selectedFile, settings])

  const handleOptimize = useCallback(() => {
    if (!selectedFile?.pdfInfo) return

    if (selectedFile.pdfInfo.num_pages >= 20) {
      setSettings((prev) => ({ ...prev, duplex: 'DuplexLongEdge', pages_per_sheet: 2 }))
      toast.success('Optimized for paper saving')
    } else if (selectedFile.pdfInfo.num_pages % 4 === 0) {
      setSettings((prev) => ({ ...prev, booklet: true, duplex: 'DuplexLongEdge' }))
      toast.success('Booklet mode enabled')
    }
  }, [selectedFile])

  const handlePrintCurrent = useCallback(async () => {
    if (!selectedFile || !selectedPrinter || !sshConfig) return
    await printFile(selectedFile)
  }, [selectedFile, selectedPrinter, sshConfig, settings])

  const handlePrintAll = useCallback(async () => {
    if (fileQueue.length === 0 || !selectedPrinter || !sshConfig) return

    setSubmitting(true)
    setPrintDialog({
      open: true,
      status: 'submitting',
      jobName: `${fileQueue.length} files`,
      printer: selectedPrinter,
    })

    let successCount = 0
    let errorCount = 0

    for (const file of fileQueue) {
      try {
        await printFile(file, true)
        successCount++
      } catch (error) {
        errorCount++
      }
    }

    setSubmitting(false)

    if (errorCount === 0) {
      setPrintDialog({
        open: true,
        status: 'success',
        jobName: `${successCount} files`,
        printer: selectedPrinter,
      })
      setTimeout(() => {
        setPrintDialog({ open: false, status: 'success' })
        navigate('/jobs')
      }, 3000)
    } else {
      setPrintDialog({
        open: true,
        status: 'error',
        jobName: `${fileQueue.length} files`,
        printer: selectedPrinter,
        error: `${successCount} succeeded, ${errorCount} failed`,
      })
    }
  }, [fileQueue, selectedPrinter, sshConfig, settings])

  const printFile = async (file: QueuedFile, silent = false) => {
    if (!selectedPrinter || !sshConfig) return

    if (!silent) {
      setSubmitting(true)
      setPrintDialog({
        open: true,
        status: 'submitting',
        jobName: file.name,
        printer: selectedPrinter,
      })
    }

    try {
      const createResult = await createPrintJob(file.name, file.path, selectedPrinter, settings)

      if (!createResult.success || !createResult.data) {
        throw new Error(createResult.error || 'Failed to create job')
      }

      const job = createResult.data
      addPrintJob(job)

      const submitResult = await submitPrintJob(job.id, sshConfig)

      if (submitResult.success) {
        if (!silent) {
          setPrintDialog({
            open: true,
            status: 'success',
            jobName: file.name,
            printer: selectedPrinter,
          })

          setTimeout(() => {
            setPrintDialog({ open: false, status: 'success' })
            navigate('/jobs')
          }, 3000)
        }
      } else {
        throw new Error(submitResult.error || 'Submission failed')
      }
    } catch (error) {
      if (!silent) {
        setPrintDialog({
          open: true,
          status: 'error',
          jobName: file.name,
          printer: selectedPrinter,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    } finally {
      if (!silent) {
        setSubmitting(false)
      }
    }
  }

  // Cleanup URLs on unmount
  useEffect(() => {
    return () => {
      fileQueue.forEach(f => {
        if (f.pdfUrl) URL.revokeObjectURL(f.pdfUrl)
      })
    }
  }, [])

  return (
    <div className="h-full flex flex-col">
      {/* File queue - horizontal at top (only show if multiple files) */}
      {fileQueue.length > 1 && (
        <div className="border-b border-border/50 bg-muted/30">
          <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto">
            <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              {fileQueue.length} files:
            </span>
            {fileQueue.map((file) => (
              <div
                key={file.id}
                onClick={() => setSelectedFileId(file.id)}
                className={cn(
                  'group relative flex items-center gap-2 px-3 py-1.5 rounded-md border cursor-pointer transition-all whitespace-nowrap',
                  selectedFileId === file.id
                    ? 'bg-primary/10 border-primary'
                    : 'border-border hover:bg-accent'
                )}
              >
                <FileText className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                <span className="text-xs font-medium text-foreground">
                  {file.name}
                </span>
                {file.pdfInfo && (
                  <span className="text-xs text-muted-foreground">
                    ({file.pdfInfo.num_pages}p)
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeFile(file.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 h-4 w-4 p-0 ml-1"
                >
                  <X className="w-2.5 h-2.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main content - 3 column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - Page Thumbnails */}
        <div className="w-48 border-r border-border/50 flex flex-col bg-muted/20">
          <div className="p-3 border-b border-border/50">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
              Preview
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {pagesToPrint.size} {pagesToPrint.size === 1 ? 'page' : 'pages'}
            </p>
          </div>

          {selectedFile && selectedFile.pdfInfo && (
            <div className="flex-1 overflow-y-auto p-2">
              <div className="space-y-2">
                {Array.from(pagesToPrint).sort((a, b) => a - b).map((pageNum) => (
                  <div
                    key={pageNum}
                    onClick={() => setPageNumber(pageNum)}
                    className={cn(
                      'group relative cursor-pointer rounded border transition-all',
                      pageNumber === pageNum
                        ? 'border-primary ring-2 ring-primary/20'
                        : 'border-border hover:border-primary/50'
                    )}
                  >
                    <div className="bg-white rounded overflow-hidden flex items-center justify-center">
                      {selectedFile.pdfUrl && (
                        <Document
                          file={selectedFile.pdfUrl}
                          loading={<div className="w-full h-full flex items-center justify-center bg-muted"><Loader2 className="w-4 h-4 animate-spin" /></div>}
                        >
                          <Page
                            pageNumber={pageNum}
                            width={160}
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                          />
                        </Document>
                      )}
                    </div>
                    <div className={cn(
                      'absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-xs font-medium',
                      pageNumber === pageNum
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-black/60 text-white'
                    )}>
                      {pageNum}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!selectedFile && (
            <div className="flex-1 flex items-center justify-center p-4 text-center">
              <p className="text-xs text-muted-foreground">
                Select a file to view pages
              </p>
            </div>
          )}
        </div>

        {/* Center - PDF Preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedFile ? (
            <>
              {/* Page navigation at top */}
              <div className="px-6 py-3 border-b border-border/50 bg-card/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Button
                      onClick={() => {
                        const pagesArray = Array.from(pagesToPrint).sort((a, b) => a - b)
                        const currentIndex = pagesArray.indexOf(pageNumber)
                        if (currentIndex > 0) {
                          setPageNumber(pagesArray[currentIndex - 1])
                        }
                      }}
                      disabled={!pagesToPrint.has(pageNumber) || Array.from(pagesToPrint).sort((a, b) => a - b).indexOf(pageNumber) === 0}
                      variant="outline"
                      size="sm"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Previous
                    </Button>
                    <span className="text-sm font-medium">
                      Page {pageNumber} of {selectedFile.pdfInfo?.num_pages || numPages}
                    </span>
                    <Button
                      onClick={() => {
                        const pagesArray = Array.from(pagesToPrint).sort((a, b) => a - b)
                        const currentIndex = pagesArray.indexOf(pageNumber)
                        if (currentIndex < pagesArray.length - 1) {
                          setPageNumber(pagesArray[currentIndex + 1])
                        }
                      }}
                      disabled={!pagesToPrint.has(pageNumber) || Array.from(pagesToPrint).sort((a, b) => a - b).indexOf(pageNumber) === Array.from(pagesToPrint).length - 1}
                      variant="outline"
                      size="sm"
                    >
                      Next
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-4">
                    {/* Zoom controls */}
                    <div className="flex items-center gap-2 border-r border-border pr-4">
                      <Button
                        onClick={handleZoomOut}
                        disabled={zoomLevel <= 0.5}
                        variant="outline"
                        size="sm"
                        title="缩小"
                      >
                        <ZoomOut className="w-4 h-4" />
                      </Button>
                      <span className="text-xs font-medium w-12 text-center">
                        {Math.round(zoomLevel * 100)}%
                      </span>
                      <Button
                        onClick={handleZoomIn}
                        disabled={zoomLevel >= 3.0}
                        variant="outline"
                        size="sm"
                        title="放大"
                      >
                        <ZoomIn className="w-4 h-4" />
                      </Button>
                      <Button
                        onClick={handleResetView}
                        variant="outline"
                        size="sm"
                        title="归位"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </Button>
                      {zoomLevel > 1.0 && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Move className="w-3 h-3" />
                          拖动移动
                        </span>
                      )}
                    </div>

                    {(settings.pages_per_sheet > 1 || settings.booklet) && (
                      <div className="text-xs text-muted-foreground">
                        {settings.booklet && <span>📖 Booklet mode</span>}
                        {settings.pages_per_sheet > 1 && <span>📄 {settings.pages_per_sheet}-up → {effectivePageCount} sheets</span>}
                      </div>
                    )}
                    <div className="text-sm text-muted-foreground">
                      {selectedFile.name}
                    </div>
                  </div>
                </div>
              </div>

              {/* PDF viewer */}
              <div
                ref={pdfContainerRef}
                className={cn(
                  "flex-1 overflow-hidden bg-muted/20 flex items-center justify-center py-8 px-4",
                  zoomLevel > 1.0 && "cursor-move"
                )}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
              >
                {selectedFile.loading ? (
                  <div className="flex items-center justify-center w-full h-full">
                    <div className="text-center">
                      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-4" />
                      <p className="text-sm text-muted-foreground">Loading PDF...</p>
                    </div>
                  </div>
                ) : selectedFile.pdfUrl && pagesToPrint.has(pageNumber) ? (
                  <div
                    className={cn(
                      "shadow-2xl bg-white",
                      !isPanning && "transition-transform duration-200",
                      isPanning && "select-none"
                    )}
                    style={{
                      transform: `translate(${panPosition.x}px, ${panPosition.y}px) scale(${zoomLevel})`,
                      transformOrigin: 'center center',
                      userSelect: isPanning ? 'none' : 'auto',
                    }}
                  >
                    <Document
                      file={selectedFile.pdfUrl}
                      onLoadSuccess={({ numPages }: { numPages: number }) => setNumPages(numPages)}
                      onLoadError={handlePDFLoadError}
                      loading={
                        <div className="flex items-center justify-center p-16">
                          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                        </div>
                      }
                    >
                      <Page
                        pageNumber={pageNumber}
                        width={pageWidth}
                        height={pageHeight}
                        onLoadSuccess={handlePageLoadSuccess}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                      />
                    </Document>
                  </div>
                ) : (
                  <div className="flex items-center justify-center w-full h-full">
                    <div className="text-center text-muted-foreground">
                      <AlertCircle className="w-12 h-12 mx-auto mb-4" />
                      <p>No pages to display</p>
                      <p className="text-sm mt-2">Adjust page range in settings</p>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Upload className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">No file selected</p>
                <p className="text-sm mt-2">Add files to start</p>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar - Print Settings */}
        <div className="w-80 border-l border-border/50 overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Quick optimize */}
            <Button
              onClick={handleOptimize}
              disabled={!selectedFile?.pdfInfo}
              className="w-full"
              variant="outline"
            >
              Optimize Settings
            </Button>

            {/* Print options */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-4">Print Options</h3>

              {/* Copies */}
              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Copies</label>
                  <span className="text-sm font-medium">{settings.copies}</span>
                </div>
                <Slider
                  value={[settings.copies]}
                  onValueChange={([val]) => setSettings({ ...settings, copies: val })}
                  min={1}
                  max={10}
                  step={1}
                />
              </div>

              {/* Double-sided */}
              <div className="flex justify-between items-center py-3 border-t border-border">
                <div>
                  <div className="text-sm font-medium">Double-Sided</div>
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
                <label className="text-sm font-medium">Paper Size</label>
                <select
                  className="px-2 py-1 text-sm border border-border rounded bg-background"
                  value={settings.paper_size}
                  onChange={(e) => setSettings({ ...settings, paper_size: e.target.value as PrintSettings['paper_size'] })}
                >
                  <option value="A4">A4</option>
                  <option value="A3">A3</option>
                </select>
              </div>

              {/* Orientation */}
              <div className="flex justify-between items-center py-3 border-t border-border">
                <label className="text-sm font-medium">Orientation</label>
                <select
                  className="px-2 py-1 text-sm border border-border rounded bg-background"
                  value={settings.orientation}
                  onChange={(e) => setSettings({ ...settings, orientation: e.target.value as PrintSettings['orientation'] })}
                >
                  <option value="Portrait">Portrait</option>
                  <option value="Landscape">Landscape</option>
                </select>
              </div>

              {/* Pages per sheet */}
              <div className="flex justify-between items-center py-3 border-t border-border">
                <div>
                  <div className="text-sm font-medium">Pages per Sheet</div>
                  <div className="text-xs text-muted-foreground">
                    {settings.pages_per_sheet === 1 ? 'Standard' : `${settings.pages_per_sheet}-up`}
                  </div>
                </div>
                <select
                  className="px-2 py-1 text-sm border border-border rounded bg-background"
                  value={settings.pages_per_sheet}
                  onChange={(e) => setSettings({ ...settings, pages_per_sheet: parseInt(e.target.value) })}
                >
                  {[1, 2, 4, 6, 9].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Printer selection */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">Printer</h3>

              {recommendedPrinter && (
                <div className="mb-3 p-2 bg-muted/50 border border-border rounded-lg">
                  <div className="text-xs text-muted-foreground mb-1">Recommended</div>
                  <div className="text-sm font-medium">{recommendedPrinter.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {recommendedPrinter.location.building}
                  </div>
                </div>
              )}

              <select
                className="w-full px-3 py-2 text-sm border border-border rounded bg-background"
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
            </div>

            {/* Cost estimate */}
            {selectedFile?.pdfInfo && (
              <div className="p-3 bg-muted/30 rounded-lg border border-border">
                <div className="text-xs text-muted-foreground mb-1">Estimated Cost</div>
                <div className="text-lg font-bold text-foreground">
                  ${estimate.cost.toFixed(2)}
                </div>
                {estimate.paperSaved > 0 && (
                  <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                    {estimate.paperSaved} sheets saved
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="border-t border-border/50 bg-card/50 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => navigate('/home')}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePrintCurrent}
              disabled={!selectedFile || !selectedPrinter || submitting}
              variant="default"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print Current
            </Button>
            {fileQueue.length > 1 && (
              <Button
                onClick={handlePrintAll}
                disabled={fileQueue.length === 0 || !selectedPrinter || submitting}
                className="bg-green-600 hover:bg-green-700"
              >
                <Printer className="w-4 h-4 mr-2" />
                Print All ({fileQueue.length})
              </Button>
            )}
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
            <AlertDialogDescription>{errorDialog.message}</AlertDialogDescription>
          </AlertDialogHeader>
          {errorDialog.technicalDetails && (
            <div className="mt-2">
              <div className="text-sm font-medium mb-2">Technical Details:</div>
              <div className="bg-muted rounded p-3 max-h-64 overflow-y-auto">
                <pre className="text-xs font-mono whitespace-pre-wrap break-words">
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
              </AlertDialogHeader>
            </>
          )}

          {printDialog.status === 'success' && (
            <>
              <AlertDialogHeader>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <AlertDialogTitle className="text-green-700 dark:text-green-400">
                    Print Job Submitted
                  </AlertDialogTitle>
                </div>
                <AlertDialogDescription>
                  Redirecting to Jobs page in 3 seconds...
                </AlertDialogDescription>
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
                  <AlertCircle className="w-6 h-6 text-red-600" />
                  <AlertDialogTitle className="text-red-700 dark:text-red-400">
                    Print Job Failed
                  </AlertDialogTitle>
                </div>
                <AlertDialogDescription>
                  {printDialog.error}
                </AlertDialogDescription>
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
