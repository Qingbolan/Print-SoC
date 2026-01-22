import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
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
  FlipHorizontal,
  RotateCcw,
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
import type { PrintSettings, Printer as PrinterType, PDFInfo, PrinterGroup } from '@/types/printer'
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

// Generate a short unique session ID
const generateSessionId = () => {
  return Math.random().toString(36).substring(2, 10)
}

export default function ModernPreviewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { sessionId } = useParams<{ sessionId?: string }>()
  const { sshConfig, printerGroups, setPrinters, addPrintJob, addDraftJob, removeDraftJob } = usePrinterStore()

  // Get all printers from groups
  const printers = printerGroups.flatMap((g: PrinterGroup) => g.printers)

  const initialFilePath = location.state?.filePath
  const initialPdfInfo = location.state?.pdfInfo
  const draftSettings = location.state?.draftSettings
  const draftPrinter = location.state?.draftPrinter

  // File queue management
  const [fileQueue, setFileQueue] = useState<QueuedFile[]>([])
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)

  // Current file state
  const [pageNumber, setPageNumber] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [recommendedPrinter, setRecommendedPrinter] = useState<PrinterType | null>(null)

  // Zoom control
  const [zoomLevel, setZoomLevel] = useState(1.0)

  // Ref for PDF container to calculate optimal size
  const pdfContainerRef = useRef<HTMLDivElement>(null)
  // Track if initial file was already added (prevent React 18 Strict Mode double-mount)
  const initialFileAddedRef = useRef(false)

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

  const [settings, setSettings] = useState<PrintSettings>(draftSettings || {
    copies: 1,
    duplex: 'DuplexLongEdge',
    orientation: 'Portrait',
    page_range: { type: 'All' },
    pages_per_sheet: 1,
    booklet: false,
    paper_size: 'A4',
  })

  const [selectedPrinter, setSelectedPrinter] = useState(draftPrinter || '')

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

  // Calculate effective sheet count after n-up
  const effectiveSheetCount = useMemo(() => {
    const pagesCount = pagesToPrint.size
    if (settings.pages_per_sheet > 1) {
      return Math.ceil(pagesCount / settings.pages_per_sheet)
    }
    return pagesCount
  }, [pagesToPrint, settings.pages_per_sheet])

  // Current sheet number for preview (1-indexed)
  const [currentSheet, setCurrentSheet] = useState(1)

  // Get n-up grid dimensions
  const nupGrid = useMemo(() => {
    switch (settings.pages_per_sheet) {
      case 2: return { cols: 2, rows: 1 }
      case 4: return { cols: 2, rows: 2 }
      case 6: return { cols: 3, rows: 2 }
      case 9: return { cols: 3, rows: 3 }
      default: return { cols: 1, rows: 1 }
    }
  }, [settings.pages_per_sheet])

  // Calculate which pages appear on the current sheet
  const pagesOnCurrentSheet = useMemo(() => {
    const sortedPages = Array.from(pagesToPrint).sort((a, b) => a - b)
    const pagesPerSheet = settings.pages_per_sheet
    const startIdx = (currentSheet - 1) * pagesPerSheet
    return sortedPages.slice(startIdx, startIdx + pagesPerSheet)
  }, [pagesToPrint, currentSheet, settings.pages_per_sheet])

  // For duplex, track if viewing front or back
  const [viewingBack, setViewingBack] = useState(false)

  // Calculate sheets for duplex preview
  const duplexSheets = useMemo(() => {
    if (settings.duplex === 'Simplex') return null

    const sortedPages = Array.from(pagesToPrint).sort((a, b) => a - b)
    const pagesPerSheet = settings.pages_per_sheet
    const sheets: { front: number[], back: number[] }[] = []

    // Group pages into sheets
    for (let i = 0; i < sortedPages.length; i += pagesPerSheet * 2) {
      const frontPages = sortedPages.slice(i, i + pagesPerSheet)
      const backPages = sortedPages.slice(i + pagesPerSheet, i + pagesPerSheet * 2)
      sheets.push({ front: frontPages, back: backPages })
    }

    return sheets
  }, [pagesToPrint, settings.pages_per_sheet, settings.duplex])

  // Get paper dimensions (width/height ratio)
  const paperDimensions = useMemo(() => {
    // A4: 210x297mm, A3: 297x420mm (width x height in portrait)
    const isLandscape = settings.orientation === 'Landscape'
    const baseWidth = settings.paper_size === 'A3' ? 297 : 210
    const baseHeight = settings.paper_size === 'A3' ? 420 : 297

    return {
      width: isLandscape ? baseHeight : baseWidth,
      height: isLandscape ? baseWidth : baseHeight,
      aspectRatio: isLandscape ? baseHeight / baseWidth : baseWidth / baseHeight,
    }
  }, [settings.paper_size, settings.orientation])

  // Calculate optimal page size for n-up grid
  // Uses actual PDF dimensions when available for accurate scaling
  const calculatePageSize = useMemo(() => {
    const { cols, rows } = nupGrid

    // Get actual PDF aspect ratio from file info, default to A4
    const pdfInfo = selectedFile?.pdfInfo
    const pdfAspectRatio = pdfInfo?.page_size
      ? pdfInfo.page_size[0] / pdfInfo.page_size[1]  // width/height from PDF
      : 210 / 297  // A4 default

    // Base container size (approximate visible area)
    const containerWidth = 450

    // Paper dimensions on screen
    const paperWidth = containerWidth
    const paperHeight = containerWidth / paperDimensions.aspectRatio

    // Each cell size in the grid (with padding)
    const padding = settings.pages_per_sheet === 1 ? 16 : 8
    const cellWidth = (paperWidth - padding * 2) / cols - (cols > 1 ? 4 : 0)
    const cellHeight = (paperHeight - padding * 2) / rows - (rows > 1 ? 4 : 0)

    // Calculate the optimal size to fit PDF in cell
    // Fit by the limiting dimension
    const fitByWidth = cellWidth
    const fitByHeight = cellHeight * pdfAspectRatio

    // Use the smaller one to ensure content fits completely
    const optimalWidth = Math.min(fitByWidth, fitByHeight)

    return {
      width: Math.max(100, Math.round(optimalWidth)),
    }
  }, [nupGrid, paperDimensions, selectedFile?.pdfInfo, settings.pages_per_sheet])

  // Generate sessionId if not present
  useEffect(() => {
    if (!sessionId) {
      const newSessionId = generateSessionId()
      navigate(`/preview/${newSessionId}`, {
        replace: true,
        state: location.state
      })
    }
  }, [sessionId, navigate, location.state])

  // Initialize with file from location state
  useEffect(() => {
    if (initialFilePath && !initialFileAddedRef.current) {
      initialFileAddedRef.current = true
      addFileToQueue(initialFilePath, initialPdfInfo)
    }
    setPrinters(PRINTERS)
  }, [])

  // Reset page/sheet number when switching files or settings change
  useEffect(() => {
    if (selectedFileId) {
      setPageNumber(1)
      setCurrentSheet(1)
      setViewingBack(false)
    }
  }, [selectedFileId])

  // Reset sheet when n-up settings change
  useEffect(() => {
    setCurrentSheet(1)
    setViewingBack(false)
  }, [settings.pages_per_sheet, settings.duplex, settings.orientation])

  // Auto-navigate to first printable page if current page is not in range
  useEffect(() => {
    if (pagesToPrint.size > 0 && !pagesToPrint.has(pageNumber)) {
      const firstPage = Math.min(...Array.from(pagesToPrint))
      setPageNumber(firstPage)
    }
  }, [pagesToPrint, pageNumber])

  // Reset zoom when file or settings change
  useEffect(() => {
    setZoomLevel(1.0)
  }, [selectedFile, settings.pages_per_sheet, settings.orientation])

  // Auto-save draft when settings change
  useEffect(() => {
    if (selectedFile?.pdfInfo && selectedFile.path) {
      const draft = {
        id: selectedFile.id,
        name: selectedFile.name,
        file_path: selectedFile.path,
        pdf_info: selectedFile.pdfInfo,
        settings: settings,
        selected_printer: selectedPrinter || undefined,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      addDraftJob(draft)
    }
  }, [selectedFile, settings, selectedPrinter, addDraftJob])

  // Zoom control functions
  const handleZoomIn = useCallback(() => {
    setZoomLevel(prev => Math.min(prev + 0.25, 3.0))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoomLevel(prev => Math.max(prev - 0.25, 0.5))
  }, [])

  const handleResetView = useCallback(() => {
    setZoomLevel(1.0)
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

    // Use functional update to check for duplicates with current state
    let isDuplicate = false
    setFileQueue(prev => {
      const existing = prev.find(f => f.path === filePath)
      if (existing) {
        isDuplicate = true
        setSelectedFileId(existing.id)
        return prev // Don't add duplicate
      }
      return [...prev, newFile]
    })

    if (isDuplicate) return

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

  // Handle file drop (for future drag-and-drop support)
  const _handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()

    const files = Array.from(e.dataTransfer.files)
    const pdfFiles = files.filter(f => f.name.toLowerCase().endsWith('.pdf'))

    if (pdfFiles.length === 0) {
      toast.error('Please drop PDF files only')
      return
    }

    // In Tauri, we can get file path from dataTransfer
    // For web compatibility, use file dialog if path not available
    for (const file of pdfFiles) {
      // Try to get path from file (Tauri provides this)
      const filePath = (file as File & { path?: string }).path
      if (filePath) {
        await addFileToQueue(filePath)
      } else {
        // Fallback: show file dialog once for all files
        toast.info('Please select the dropped file(s) in the dialog')
        const { open } = await import('@tauri-apps/plugin-dialog')
        const selectedPath = await open({
          multiple: false,
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        })
        if (selectedPath) {
          await addFileToQueue(selectedPath as string)
        }
        break // Only show dialog once
      }
    }
  }

  // Handle file selection (for future use)
  const _handleFileSelect = async () => {
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
      const online = printers.filter((p: PrinterType) => p.status === 'Online')
      if (online.length > 0) {
        const recommended = online.sort((a: PrinterType, b: PrinterType) => (b.paper_level || 0) - (a.paper_level || 0))[0]
        setRecommendedPrinter(recommended)
        setSelectedPrinter(recommended.queue_name)
      } else {
        setSelectedPrinter(printers[0]?.queue_name || '')
      }
    }
  }, [printers, selectedPrinter])

  const handlePrintCurrent = useCallback(async () => {
    if (!selectedFile) return
    if (!selectedPrinter) {
      toast.error('Please select a printer')
      return
    }
    if (!sshConfig) {
      toast.error('Not connected to server. Please login first.')
      return
    }
    await printFile(selectedFile)
  }, [selectedFile, selectedPrinter, sshConfig, settings])

  const handlePrintAll = useCallback(async () => {
    if (fileQueue.length === 0) return
    if (!selectedPrinter) {
      toast.error('Please select a printer')
      return
    }
    if (!sshConfig) {
      toast.error('Not connected to server. Please login first.')
      return
    }

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
    if (!selectedPrinter) {
      toast.error('Please select a printer')
      return
    }
    if (!sshConfig) {
      toast.error('Not connected to server. Please login first.')
      return
    }

    const copies = settings.copies
    const totalJobs = copies > 1 ? copies : 1
    const jobLabel = copies > 1 ? `${file.name} (${copies} copies)` : file.name

    if (!silent) {
      setSubmitting(true)
      setPrintDialog({
        open: true,
        status: 'submitting',
        jobName: jobLabel,
        printer: selectedPrinter,
      })
    }

    try {
      // Settings for each job (copies = 1 since we submit multiple jobs)
      const jobSettings = { ...settings, copies: 1 }

      // Submit multiple jobs for multiple copies
      for (let copyNum = 1; copyNum <= totalJobs; copyNum++) {
        // Generate job name with copy number suffix for multiple copies
        const baseName = file.name.replace(/\.pdf$/i, '')
        const jobName = copies > 1
          ? `${baseName}-copy${copyNum}.pdf`
          : file.name

        const createResult = await createPrintJob(jobName, file.path, selectedPrinter, jobSettings)

        if (!createResult.success || !createResult.data) {
          throw new Error(createResult.error || `Failed to create job (copy ${copyNum})`)
        }

        const job = createResult.data
        addPrintJob(job)

        const submitResult = await submitPrintJob(job.id, sshConfig)

        if (!submitResult.success) {
          throw new Error(submitResult.error || `Submission failed (copy ${copyNum})`)
        }
      }

      // Remove draft after successful print
      removeDraftJob(file.id)

      if (!silent) {
        setPrintDialog({
          open: true,
          status: 'success',
          jobName: jobLabel,
          printer: selectedPrinter,
        })

        setTimeout(() => {
          setPrintDialog({ open: false, status: 'success' })
          navigate('/jobs')
        }, 3000)
      }
    } catch (error) {
      if (!silent) {
        setPrintDialog({
          open: true,
          status: 'error',
          jobName: jobLabel,
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
        {/* Left sidebar - Sheet Thumbnails */}
        <div className="w-48 border-r border-border/50 flex flex-col bg-background">
          <div className="px-4 py-3 border-b border-border/50">
            <h3 className="text-sm font-semibold text-foreground">
              {settings.pages_per_sheet > 1 ? 'SHEETS' : 'PAGES'}
            </h3>
            <p className="text-xs text-muted-foreground">
              {settings.pages_per_sheet > 1
                ? `${effectiveSheetCount} ${effectiveSheetCount === 1 ? 'sheet' : 'sheets'} (${pagesToPrint.size} pages)`
                : `${pagesToPrint.size} ${pagesToPrint.size === 1 ? 'page' : 'pages'}`
              }
            </p>
          </div>

          {selectedFile && selectedFile.pdfInfo && (
            <div className="flex-1 overflow-y-auto p-3">
              <div className="space-y-3">
                {Array.from({ length: effectiveSheetCount }, (_, idx) => {
                  const sheetNum = idx + 1
                  const sortedPages = Array.from(pagesToPrint).sort((a, b) => a - b)
                  const startIdx = idx * settings.pages_per_sheet
                  const sheetPages = sortedPages.slice(startIdx, startIdx + settings.pages_per_sheet)

                  return (
                    <div
                      key={sheetNum}
                      onClick={() => setCurrentSheet(sheetNum)}
                      className={cn(
                        'group relative cursor-pointer rounded-lg overflow-hidden transition-all',
                        currentSheet === sheetNum
                          ? 'ring-2 ring-primary shadow-lg'
                          : 'ring-1 ring-border hover:ring-primary/50 hover:shadow-md'
                      )}
                    >
                      {/* Mini n-up grid preview */}
                      <div
                        className="bg-white p-1 grid gap-0.5"
                        style={{
                          gridTemplateColumns: `repeat(${nupGrid.cols}, 1fr)`,
                          gridTemplateRows: `repeat(${nupGrid.rows}, 1fr)`,
                          aspectRatio: `${paperDimensions.width} / ${paperDimensions.height}`,
                        }}
                      >
                        {Array.from({ length: settings.pages_per_sheet }, (_, i) => {
                          const pageNum = sheetPages[i]
                          // Calculate thumbnail page width based on grid
                          const thumbWidth = Math.max(30, Math.floor(130 / nupGrid.cols))
                          return (
                            <div key={i} className="bg-muted rounded-sm overflow-hidden flex items-center justify-center">
                              {pageNum && selectedFile.pdfUrl ? (
                                <Document file={selectedFile.pdfUrl} loading={null}>
                                  <Page
                                    pageNumber={pageNum}
                                    width={thumbWidth}
                                    renderTextLayer={false}
                                    renderAnnotationLayer={false}
                                  />
                                </Document>
                              ) : (
                                <span className="text-[8px] text-muted-foreground/50">-</span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                      {/* Sheet number badge */}
                      <div className={cn(
                        'absolute bottom-2 right-2 min-w-6 h-6 flex items-center justify-center px-1.5 rounded-full text-xs font-semibold shadow-sm',
                        currentSheet === sheetNum
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-black/70 text-white'
                      )}>
                        {sheetNum}
                      </div>
                      {/* Pages info */}
                      {settings.pages_per_sheet > 1 && (
                        <div className="absolute top-1 left-1 text-[9px] bg-black/50 text-white px-1 rounded">
                          p.{sheetPages[0]}-{sheetPages[sheetPages.length - 1]}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {!selectedFile && (
            <div className="flex-1 flex items-center justify-center p-4 text-center">
              <p className="text-xs text-muted-foreground">
                Select a file to view
              </p>
            </div>
          )}
        </div>

        {/* Center - PDF Preview */}
        <div className="flex-1 flex flex-col overflow-hidden bg-muted/30">
          {selectedFile ? (
            <>
              {/* Sheet navigation at top */}
              <div className="px-4 py-3 border-b border-border/50 bg-background">
                <div className="flex items-center justify-between gap-4">
                  {/* Sheet navigation */}
                  <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
                    <Button
                      onClick={() => setCurrentSheet(s => Math.max(1, s - 1))}
                      disabled={currentSheet <= 1}
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-sm font-medium px-3 min-w-[80px] text-center">
                      {settings.pages_per_sheet > 1 ? (
                        <>Sheet {currentSheet} / {effectiveSheetCount}</>
                      ) : (
                        <>{currentSheet} / {pagesToPrint.size}</>
                      )}
                    </span>
                    <Button
                      onClick={() => setCurrentSheet(s => Math.min(effectiveSheetCount, s + 1))}
                      disabled={currentSheet >= effectiveSheetCount}
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Duplex flip control */}
                  {settings.duplex !== 'Simplex' && (
                    <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
                      <Button
                        onClick={() => setViewingBack(v => !v)}
                        variant={viewingBack ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-8 px-3 gap-2"
                      >
                        <FlipHorizontal className="w-4 h-4" />
                        <span className="text-xs">{viewingBack ? 'Back' : 'Front'}</span>
                      </Button>
                    </div>
                  )}

                  {/* Zoom controls */}
                  <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
                    <Button
                      onClick={handleZoomOut}
                      disabled={zoomLevel <= 0.5}
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </Button>
                    <span className="text-sm font-medium px-2 min-w-[50px] text-center">
                      {Math.round(zoomLevel * 100)}%
                    </span>
                    <Button
                      onClick={handleZoomIn}
                      disabled={zoomLevel >= 3.0}
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </Button>
                    <div className="w-px h-5 bg-border mx-1" />
                    <Button
                      onClick={handleResetView}
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Reset view"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Settings indicator */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="bg-muted px-2 py-1 rounded">{settings.paper_size}</span>
                    <span className="bg-muted px-2 py-1 rounded">{settings.orientation}</span>
                    {settings.pages_per_sheet > 1 && (
                      <span className="bg-primary/20 text-primary px-2 py-1 rounded font-medium">
                        {settings.pages_per_sheet}-up
                      </span>
                    )}
                    {settings.duplex !== 'Simplex' && (
                      <span className="bg-success/20 text-success px-2 py-1 rounded font-medium">
                        Duplex
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* PDF viewer - Intelligent Preview */}
              <div
                ref={pdfContainerRef}
                className={cn(
                  "flex-1 flex items-center justify-center p-6 overflow-auto"
                )}
              >
                {selectedFile.loading ? (
                  <div className="flex items-center justify-center w-full h-full">
                    <div className="text-center">
                      <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
                      <p className="text-sm font-medium text-muted-foreground">Loading PDF...</p>
                    </div>
                  </div>
                ) : selectedFile.pdfUrl && pagesOnCurrentSheet.length > 0 ? (
                  <div
                    className="shadow-2xl bg-white rounded-lg ring-1 ring-black/10 transition-all duration-300 relative flex-shrink-0"
                    style={{
                      transform: `scale(${zoomLevel})`,
                      transformOrigin: 'center center',
                      // Fixed width that matches calculatePageSize container assumption
                      width: settings.orientation === 'Landscape' ? '550px' : '450px',
                      aspectRatio: `${paperDimensions.width} / ${paperDimensions.height}`,
                    }}
                  >
                    {/* N-up grid layout */}
                    <div
                      className="w-full h-full grid bg-white"
                      style={{
                        gridTemplateColumns: `repeat(${nupGrid.cols}, 1fr)`,
                        gridTemplateRows: `repeat(${nupGrid.rows}, 1fr)`,
                        gap: settings.pages_per_sheet === 1 ? '0px' : '4px',
                        padding: settings.pages_per_sheet === 1 ? '16px' : '8px',
                      }}
                    >
                      {(() => {
                        // Get pages to display based on duplex setting
                        let pagesToShow = pagesOnCurrentSheet
                        if (settings.duplex !== 'Simplex' && duplexSheets) {
                          const sheetIdx = currentSheet - 1
                          if (sheetIdx < duplexSheets.length) {
                            pagesToShow = viewingBack
                              ? duplexSheets[sheetIdx].back
                              : duplexSheets[sheetIdx].front
                          }
                        }

                        // Fill grid with pages or empty slots
                        const slots = []
                        for (let i = 0; i < settings.pages_per_sheet; i++) {
                          const pageNum = pagesToShow[i]
                          slots.push(
                            <div
                              key={i}
                              className={cn(
                                "flex items-center justify-center relative",
                                settings.pages_per_sheet > 1 && "bg-muted/50 rounded border border-border overflow-hidden"
                              )}
                            >
                              {pageNum ? (
                                <Document
                                  file={selectedFile.pdfUrl}
                                  loading={
                                    <div className="flex items-center justify-center w-full h-full">
                                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                    </div>
                                  }
                                >
                                  <Page
                                    pageNumber={pageNum}
                                    width={calculatePageSize.width}
                                    renderTextLayer={false}
                                    renderAnnotationLayer={false}
                                  />
                                </Document>
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-muted/50">
                                  <span className="text-xs text-muted-foreground/50">Empty</span>
                                </div>
                              )}
                              {/* Page number indicator for n-up */}
                              {settings.pages_per_sheet > 1 && pageNum && (
                                <div className="absolute bottom-1 right-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
                                  {pageNum}
                                </div>
                              )}
                            </div>
                          )
                        }
                        return slots
                      })()}
                    </div>

                    {/* Side indicator for duplex */}
                    {settings.duplex !== 'Simplex' && (
                      <div className={cn(
                        "absolute bottom-2 left-2 text-xs px-2 py-1 rounded-full font-medium",
                        viewingBack
                          ? "bg-warning/20 text-warning"
                          : "bg-accent/20 text-accent"
                      )}>
                        {viewingBack ? 'Back Side' : 'Front Side'}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center w-full h-full">
                    <div className="text-center text-muted-foreground">
                      <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p className="font-medium">No pages to display</p>
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
        <div className="w-72 border-l border-border/50 overflow-y-auto bg-background">
          <div className="p-4 space-y-4">
            {/* Print options */}
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground px-1 mb-3">Print Options</h3>

              {/* Copies */}
              <div className="flex justify-between items-center py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                <label className="text-sm text-foreground">Copies</label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[settings.copies]}
                    onValueChange={([val]) => setSettings({ ...settings, copies: val })}
                    min={1}
                    max={10}
                    step={1}
                    className="w-20"
                  />
                  <span className="text-sm font-semibold w-6 text-right">{settings.copies}</span>
                </div>
              </div>

              {/* Double-sided */}
              <div className="flex justify-between items-center py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                <div>
                  <div className="text-sm text-foreground">Double-Sided</div>
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
              <div className="flex justify-between items-center py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                <label className="text-sm text-foreground">Paper Size</label>
                <select
                  className="px-3 py-1.5 text-sm border border-border rounded-md bg-background font-medium"
                  value={settings.paper_size}
                  onChange={(e) => setSettings({ ...settings, paper_size: e.target.value as PrintSettings['paper_size'] })}
                >
                  <option value="A4">A4</option>
                  <option value="A3">A3</option>
                </select>
              </div>

              {/* Orientation */}
              <div className="flex justify-between items-center py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                <label className="text-sm text-foreground">Orientation</label>
                <select
                  className="px-3 py-1.5 text-sm border border-border rounded-md bg-background font-medium"
                  value={settings.orientation}
                  onChange={(e) => setSettings({ ...settings, orientation: e.target.value as PrintSettings['orientation'] })}
                >
                  <option value="Portrait">Portrait</option>
                  <option value="Landscape">Landscape</option>
                </select>
              </div>

              {/* Pages per sheet */}
              <div className="flex justify-between items-center py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                <div>
                  <div className="text-sm text-foreground">Pages per Sheet</div>
                  <div className="text-xs text-muted-foreground">
                    {settings.pages_per_sheet === 1 ? 'Standard' : `${settings.pages_per_sheet}-up`}
                  </div>
                </div>
                <select
                  className="px-3 py-1.5 text-sm border border-border rounded-md bg-background font-medium"
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
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground px-1">Printer</h3>

              {recommendedPrinter && (
                <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
                  <div className="text-xs text-primary/70 font-medium mb-1">Recommended</div>
                  <div className="text-sm font-semibold text-foreground">{recommendedPrinter.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {recommendedPrinter.location.building}
                  </div>
                </div>
              )}

              <select
                className="w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-background font-medium"
                value={selectedPrinter}
                onChange={(e) => setSelectedPrinter(e.target.value)}
              >
                {printerGroups.map((group: PrinterGroup) => (
                  <optgroup key={group.id} label={group.display_name}>
                    {group.printers.map((p: PrinterType) => (
                      <option key={p.id} value={p.queue_name}>
                        {p.name} {p.variant && `(${p.variant})`}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

          </div>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="border-t border-border/50 bg-background px-4 py-3">
        <div className="flex items-center justify-end gap-3">
          <Button
            variant="ghost"
            onClick={() => navigate('/home')}
            className="text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handlePrintCurrent}
            disabled={!selectedFile || !selectedPrinter || submitting}
            size="lg"
            className="px-6"
          >
            <Printer className="w-4 h-4 mr-2" />
            {settings.copies > 1 ? `Print ${settings.copies} Copies` : 'Print'}
          </Button>
          {fileQueue.length > 1 && (
            <Button
              onClick={handlePrintAll}
              disabled={fileQueue.length === 0 || !selectedPrinter || submitting}
              size="lg"
              className="px-6 bg-success hover:bg-success-hover"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print All ({fileQueue.length})
            </Button>
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
                  {printDialog.jobName}
                </AlertDialogDescription>
              </AlertDialogHeader>
            </>
          )}

          {printDialog.status === 'success' && (
            <>
              <AlertDialogHeader>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center">
                    <svg className="w-6 h-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <AlertDialogTitle className="text-success">
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
                  <AlertCircle className="w-6 h-6 text-destructive" />
                  <AlertDialogTitle className="text-destructive">
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
