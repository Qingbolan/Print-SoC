import { requireReadyDocument, type QueuedDocument } from '@/lib/document-state'
import { JobProgress } from '@/components/jobs/JobProgress'
import { useNativeFileDrop } from '@/hooks/useNativeFileDrop'
import { PdfSheet } from '@/components/preview/PdfSheet'
import { makeSheets, makeBookletSheets, duplexForTurn, bindingAxis, backRotation, type TurnAxis } from '@/lib/print-preview'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { usePrinterStore } from '@/store/printer-store'
import { getDefaultPrinterQueue, normalizePrintQueueName } from '@/data/printers'
import { pdfjs } from 'react-pdf'
import {
  createPrintJob,
  submitPrintJob,
} from '@/lib/printer-api'
import { Button } from '@/components/ui/button'
import { DUPLEX_LABELS } from '@/lib/print-settings'
import { Slider } from '@/components/ui/slider'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageScaffold } from '@/components/layout/PageScaffold'
import { FileErrorDialog } from '@/components/common/FileErrorDialog'
import { prepareDocument, browseDocument } from '@/lib/documents'
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
  FileSearch,
  RotateCcw,
  ArrowLeft,
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
import type { PrintSettings, Printer as PrinterType, PrinterGroup } from '@/types/printer'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// Use local worker file instead of CDN for Tauri app
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

type QueuedFile = QueuedDocument

// Generate a short unique session ID
const generateSessionId = () => {
  return Math.random().toString(36).substring(2, 10)
}

export default function ModernPreviewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { sessionId } = useParams<{ sessionId?: string }>()
  const {
    sshConfig,
    connectionStatus,
    printerGroups,
    settings: appSettings,
    addPrintJob,
    addDraftJob,
    removeDraftJob,
    quickPrintPrinter,
    setQuickPrintPrinter,
  } = usePrinterStore()
  const activeSshConfig = connectionStatus.type === 'connected' ? sshConfig : null

  // Get all printers from groups
  const printers = printerGroups.flatMap((g: PrinterGroup) => g.printers)

  const initialFilePath = location.state?.filePath
  const draftSettings = location.state?.draftSettings
  const draftPrinter = location.state?.draftPrinter

  // File queue management
  const [fileQueue, setFileQueue] = useState<QueuedFile[]>([])
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)

  // Current file state
  const [submitting, setSubmitting] = useState(false)
  const submissionInFlight = useRef(false)
  const [recommendedPrinter, setRecommendedPrinter] = useState<PrinterType | null>(null)

  // Zoom control
  const [zoomLevel, setZoomLevel] = useState(1.0)

  // Ref for PDF container to calculate optimal size
  const pdfContainerRef = useRef<HTMLDivElement>(null)
  const [previewPaperWidth, setPreviewPaperWidth] = useState(1)
  const fileQueueRef = useRef<QueuedFile[]>([])
  const mountedRef = useRef(true)
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

  const sheets = useMemo(() => settings.booklet
    ? makeBookletSheets(Array.from(pagesToPrint))
    : makeSheets(Array.from(pagesToPrint), settings.pages_per_sheet, settings.duplex),
    [pagesToPrint, settings.pages_per_sheet, settings.duplex, settings.booklet])
  const effectiveSheetCount = sheets.length

  // Current sheet number for preview (1-indexed)
  const [currentSheet, setCurrentSheet] = useState(1)

  // Get n-up grid dimensions
  const nupGrid = useMemo(() => {
    switch (settings.booklet ? 2 : settings.pages_per_sheet) {
      case 2: return { cols: 2, rows: 1 }
      case 4: return { cols: 2, rows: 2 }
      case 6: return { cols: 3, rows: 2 }
      case 9: return { cols: 3, rows: 3 }
      default: return { cols: 1, rows: 1 }
    }
  }, [settings.pages_per_sheet, settings.booklet])

  const [viewingBack, setViewingBack] = useState(false)
  const [turnAxis, setTurnAxis] = useState<TurnAxis>('vertical')
  const currentPhysicalSheet = sheets[currentSheet - 1]
  const pagesOnCurrentSheet = currentPhysicalSheet
    ? (viewingBack ? currentPhysicalSheet.back : currentPhysicalSheet.front) : []
  const selectedBindingAxis = bindingAxis(settings.duplex, settings.orientation)
  useEffect(() => { setTurnAxis(selectedBindingAxis) }, [selectedBindingAxis])

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

  useEffect(() => {
    const container = pdfContainerRef.current
    if (!container || !selectedFile) return

    const updatePaperWidth = () => {
      const { width, height } = container.getBoundingClientRect()
      const widthFromContainer = width * 0.82
      const widthFromHeight = height * paperDimensions.aspectRatio * 0.82
      setPreviewPaperWidth(Math.max(1, Math.floor(Math.min(widthFromContainer, widthFromHeight))))
    }

    updatePaperWidth()
    const observer = new ResizeObserver(updatePaperWidth)
    observer.observe(container)
    return () => observer.disconnect()
  }, [paperDimensions.aspectRatio, selectedFile])

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
      addFileToQueue(initialFilePath, location.state?.fileName)
    }
  }, [])

  // Reset page/sheet number when switching files or settings change
  useEffect(() => {
    if (selectedFileId) {
      setCurrentSheet(1)
      setViewingBack(false)
    }
  }, [selectedFileId])

  useEffect(() => {
    setCurrentSheet(sheet => Math.max(1, Math.min(sheet, effectiveSheetCount)))
  }, [effectiveSheetCount])

  // Reset sheet when n-up settings change
  useEffect(() => {
    setCurrentSheet(1)
    setViewingBack(false)
  }, [settings.pages_per_sheet, settings.orientation])

  useEffect(() => {
    if (settings.duplex === 'Simplex') setViewingBack(false)
  }, [settings.duplex])



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

  const updateFileQueue = useCallback((update: (current: QueuedFile[]) => QueuedFile[]) => {
    const next = update(fileQueueRef.current)
    fileQueueRef.current = next
    setFileQueue(next)
    return next
  }, [])

  // Add file to queue
  const addFileToQueue = async (filePath: string, displayName?: string) => {
    const fileName = displayName || filePath.split(/[\\/]/).pop() || 'document'
    const fileId = `${Date.now()}-${Math.random()}`

    const newFile: QueuedFile = {
      id: fileId,
      sourcePath: filePath,
      path: null,
      name: fileName,
      pdfUrl: null,
      pdfInfo: null,
      state: 'preparing',
      error: null,
    }

    const existing = fileQueueRef.current.find(f => f.sourcePath === filePath)
    if (existing) {
      setSelectedFileId(existing.id)
      return
    }

    updateFileQueue(current => [...current, newFile])

    if (!selectedFileId) {
      setSelectedFileId(fileId)
    }

    let objectUrl: string | null = null

    // Load PDF
    try {
      const result = await prepareDocument(filePath)
      if (!result.success || !result.data) throw new Error(result.error || 'Document conversion failed')
      const prepared = result.data
      if (!mountedRef.current || !fileQueueRef.current.some(file => file.id === fileId)) return
      const { readFile } = await import('@tauri-apps/plugin-fs')
      const data = await readFile(prepared.path)
      const blob = new Blob([data], { type: 'application/pdf' })
      objectUrl = URL.createObjectURL(blob)

      if (!mountedRef.current || !fileQueueRef.current.some(file => file.id === fileId)) {
        URL.revokeObjectURL(objectUrl)
        objectUrl = null
        return
      }

      const readyUrl = objectUrl
      updateFileQueue(current => current.map(f =>
        f.id === fileId
          ? { ...f, error: null, path: prepared.path, name: displayName || prepared.name, pdfUrl: readyUrl, pdfInfo: prepared.info, state: 'ready' as const }
          : f
      ))
    } catch (error) {
      console.error('Error loading PDF:', error)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      if (!mountedRef.current) return
      updateFileQueue(current => current.map(f =>
        f.id === fileId
          ? { ...f, path: null, pdfUrl: null, pdfInfo: null, error: error instanceof Error ? error.message : 'Failed to prepare document', state: 'failed' as const }
          : f
      ))
    }
  }

  const handleBrowseFile = async () => {
    let file: string | string[] | null
    try { file = await browseDocument() }
    catch (error) { toast.error(String(error)); return }

    if (file) {
      await addFileToQueue(file as string)
    }
  }

  useNativeFileDrop(paths => {
    if (paths.length !== 1) { toast.error('Drop one document at a time'); return }
    void addFileToQueue(paths[0])
  })

  // Remove file from queue
  const removeFile = (fileId: string) => {
    const file = fileQueueRef.current.find(f => f.id === fileId)
    if (file?.pdfUrl) {
      URL.revokeObjectURL(file.pdfUrl)
    }

    const remaining = updateFileQueue(current => current.filter(f => f.id !== fileId))

    if (selectedFileId === fileId) {
      setSelectedFileId(remaining.length > 0 ? remaining[0].id : null)
    }
  }

  // Handle quick print printer (from printers page detail sheet)
  useEffect(() => {
    if (quickPrintPrinter) {
      setSelectedPrinter(quickPrintPrinter)
      // Clear the quick print printer after using it
      setQuickPrintPrinter(null)
    }
  }, [quickPrintPrinter, setQuickPrintPrinter])

  // Set recommended printer
  useEffect(() => {
    if (printers.length > 0 && !selectedPrinter && !quickPrintPrinter) {
      const defaultQueue = normalizePrintQueueName(appSettings.defaultPrinter) || getDefaultPrinterQueue()
      const defaultPrinter = printers.find((p: PrinterType) => p.queue_name === defaultQueue)
      if (defaultPrinter) {
        setRecommendedPrinter(defaultPrinter)
        setSelectedPrinter(defaultPrinter.queue_name)
        return
      }

      const online = printers.filter((p: PrinterType) => p.status === 'Online')
      if (online.length > 0) {
        const recommended = online.sort((a: PrinterType, b: PrinterType) => (b.paper_level || 0) - (a.paper_level || 0))[0]
        setRecommendedPrinter(recommended)
        setSelectedPrinter(recommended.queue_name)
      } else {
        setSelectedPrinter(printers[0]?.queue_name || '')
      }
    }
  }, [printers, selectedPrinter, quickPrintPrinter, appSettings.defaultPrinter])

  const handlePrintCurrent = useCallback(async () => {
    if (!selectedFile) return
    if (!selectedPrinter) {
      toast.error('Please select a printer')
      return
    }
    if (!activeSshConfig) {
      toast.error('Not connected to server. Please login first.')
      return
    }
    if (submissionInFlight.current) return
    submissionInFlight.current = true
    try { await printFile(selectedFile) }
    catch (error) { toast.error(String(error)) }
    finally { submissionInFlight.current = false }
  }, [selectedFile, selectedPrinter, activeSshConfig, settings])

  const handlePrintAll = useCallback(async () => {
    if (fileQueue.length === 0) return
    if (!selectedPrinter) {
      toast.error('Please select a printer')
      return
    }
    if (!activeSshConfig) {
      toast.error('Not connected to server. Please login first.')
      return
    }

    if (submissionInFlight.current) return
    try { fileQueue.forEach(requireReadyDocument) }
    catch (error) { toast.error(String(error)); return }
    submissionInFlight.current = true
    setSubmitting(true)
    setPrintDialog({
      open: true,
      status: 'submitting',
      jobName: `${fileQueue.length} files`,
      printer: selectedPrinter,
    })

    let successCount = 0
    let errorCount = 0
    let failureReason = ''

    for (const file of fileQueue) {
      try {
        await printFile(file, true)
        successCount++
      } catch (error) {
        errorCount = fileQueue.length - successCount
        failureReason = error instanceof Error ? error.message : String(error)
        break
      }
    }

    setSubmitting(false)
    submissionInFlight.current = false

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
        error: `${successCount} submitted; ${errorCount} not confirmed or not attempted. ${failureReason}`,
      })
    }
  }, [fileQueue, selectedPrinter, activeSshConfig, settings])

  const [activeJobId, setActiveJobId] = useState<string | null>(null)

  const printFile = async (file: QueuedFile, silent = false) => {
    if (!selectedPrinter) {
      toast.error('Please select a printer')
      return
    }
    if (!activeSshConfig) {
      toast.error('Not connected to server. Please login first.')
      return
    }

    const readyFile = requireReadyDocument(file)
    const copies = settings.copies
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
      // One document is one spooler job, including all requested copies.
      // Its receipt therefore describes the whole user action.
      const createResult = await createPrintJob(file.name, readyFile.path, selectedPrinter, settings)
      if (!createResult.success || !createResult.data) {
        throw new Error(createResult.error || 'Failed to create print job')
      }
      const job = createResult.data
      addPrintJob(job)
      setActiveJobId(job.id)
      const submitResult = await submitPrintJob(job.id, activeSshConfig)
      if (!submitResult.success) throw new Error(submitResult.error || 'Submission failed')

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

  // Cleanup every object URL that is still owned by the queue on unmount.
  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      fileQueueRef.current.forEach(f => {
        if (f.pdfUrl) URL.revokeObjectURL(f.pdfUrl)
      })
    }
  }, [])

  return (
    <PageScaffold
      header={
        <PageHeader
          title="Print preview"
          description={selectedFile ? selectedFile.name : 'Review layout, queue, and output settings'}
          icon={<FileSearch />}
          actions={
            <>
              <span className="hidden text-xs font-medium text-muted-foreground sm:inline">Step {selectedFile ? 2 : 1} of 3</span>
              <Button variant="outline" size="sm" onClick={() => navigate('/home')}>
                <ArrowLeft className="size-4" />
                Workbench
              </Button>
            </>
          }
        />
      }
      contentClassName={selectedFile ? 'overflow-hidden' : 'overflow-y-auto'}
      contentInnerClassName={selectedFile ? 'h-full' : undefined}
      contentWidth={selectedFile ? 'full' : 'wide'}
    >
    <div className={cn(
      'flex min-h-0 flex-col overflow-hidden rounded-md bg-card',
      selectedFile && 'h-full',
    )}>
      {/* File queue - horizontal at top (only show if multiple files) */}
      {fileQueue.length > 1 && (
        <div className="bg-muted/45">
          <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto">
            <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              {fileQueue.length} files:
            </span>
            {fileQueue.map((file) => (
              <div
                key={file.id}
                onClick={() => setSelectedFileId(file.id)}
                className={cn(
                  'group relative flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 transition-colors',
                  selectedFileId === file.id
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent'
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
                  className="ml-1 h-5 w-5 p-0 opacity-70 hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="w-2.5 h-2.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main content - 3 column layout */}
      <div className="grid min-h-0 flex-1 overflow-hidden max-md:overflow-y-auto md:grid-cols-3 xl:grid-cols-7">
        {/* Left sidebar - Sheet Thumbnails */}
        {selectedFile && (
        <div className="hidden min-h-0 flex-col bg-muted/45 xl:col-span-1 xl:flex">
          <div className="px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              SHEETS
            </h3>
            <p className="text-xs text-muted-foreground">
              {effectiveSheetCount} sheets · {pagesToPrint.size} source pages
            </p>
          </div>

          {selectedFile && selectedFile.pdfInfo && (
            <div className="flex-1 overflow-y-auto p-3">
              <div className="space-y-3">
                {Array.from({ length: effectiveSheetCount }, (_, idx) => {
                  const sheetNum = idx + 1
                  const sheetPages = sheets[idx].front

                  return (
                    <div
                      key={sheetNum}
                      onClick={() => setCurrentSheet(sheetNum)}
                      className={cn(
                        'group relative cursor-pointer rounded-lg overflow-hidden transition-all',
                        currentSheet === sheetNum
                          ? 'ring-2 ring-primary'
                          : 'ring-1 ring-border hover:ring-primary/50'
                      )}
                    >
                      <div className="bg-white" style={{ aspectRatio: `${paperDimensions.width} / ${paperDimensions.height}` }}>
                        {selectedFile.pdfUrl && <PdfSheet file={selectedFile.pdfUrl} pages={sheetPages} cols={nupGrid.cols} rows={nupGrid.rows} />}
                      </div>
                      {/* Sheet number badge */}
                      <div className={cn(
                        'absolute bottom-2 right-2 flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs font-semibold',
                        currentSheet === sheetNum
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-black/70 text-white'
                      )}>
                        {sheetNum}
                      </div>
                      {/* Pages info */}
                      {settings.pages_per_sheet > 1 && (
                        <div className="absolute left-1 top-1 rounded bg-black/50 px-1 text-xs text-white">
                          p.{sheetPages[0]}-{sheetPages[sheetPages.length - 1]}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

        </div>
        )}

        {/* Center - PDF Preview */}
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden',
            selectedFile
              ? 'bg-muted/55 md:col-span-2 xl:col-span-4'
              : 'bg-card md:col-span-3 xl:col-span-7',
          )}
        >
          {selectedFile ? (
            <>
              {/* Sheet navigation at top */}
              <div className="bg-workspace px-4 py-3">
                <div className="flex items-center justify-between gap-3 overflow-x-auto">
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
                    <span className="px-3 text-center text-sm font-medium tabular-nums">
                      Sheet {currentSheet} / {effectiveSheetCount}
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
                        <span className="text-xs">{viewingBack ? 'Show front' : 'Show back'}</span>
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
                    <span className="px-2 text-center text-sm font-medium tabular-nums">
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
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <span className="bg-muted px-2 py-1 rounded">{settings.paper_size}</span>
                    <span className="bg-muted px-2 py-1 rounded">{settings.orientation}</span>
                    {settings.pages_per_sheet > 1 && (
                      <span className="bg-primary/20 text-primary px-2 py-1 rounded font-medium">
                        {settings.pages_per_sheet}-up
                      </span>
                    )}
                    {settings.duplex !== 'Simplex' && (
                      <span className="bg-success/20 text-success px-2 py-1 rounded font-medium">
                        {DUPLEX_LABELS[settings.duplex]}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {settings.duplex !== 'Simplex' && (
                <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
                  <label htmlFor="preview-turn">Turn the paper</label>
                  <select id="preview-turn" className="rounded border border-border bg-background px-2 py-1" value={turnAxis} onChange={e => {
                    const turn = e.target.value as TurnAxis
                    setTurnAxis(turn)
                    setSettings(previous => ({ ...previous, duplex: duplexForTurn(turn, previous.orientation) }))
                  }}>
                    <option value="vertical">Left to right (book)</option>
                    <option value="horizontal">Top to bottom (calendar)</option>
                  </select>
                  <span>{viewingBack ? 'Back' : 'Front'} · Binding: {selectedBindingAxis === 'vertical' ? 'left / right edge' : 'top / bottom edge'}</span>
                  {viewingBack && pagesOnCurrentSheet.length === 0 && <span>Blank back — nothing will be printed here</span>}
                  {viewingBack && backRotation(settings.duplex, settings.orientation, turnAxis) === 180 && <span>Back is upside down with this turning direction.</span>}
                </div>
              )}

              {/* PDF viewer - Intelligent Preview */}
              <div
                ref={pdfContainerRef}
                className={cn(
                  "min-h-0 flex-1 flex p-6 overflow-auto"
                )}
              >
                {selectedFile.error ? (
                  <div role="alert" className="m-auto p-6 text-center text-destructive">
                    <p className="font-medium">Document could not be prepared</p>
                    <p className="mt-2 text-sm">{selectedFile.error}</p>
                    <Button variant="secondary" className="mt-4" onClick={handleBrowseFile}>Choose another document</Button>
                  </div>
                ) : selectedFile.state === 'preparing' ? (
                  <div className="flex items-center justify-center w-full h-full">
                    <div className="text-center">
                      <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
                      <p className="text-sm font-medium text-muted-foreground">Preparing document...</p>
                    </div>
                  </div>
                ) : selectedFile.pdfUrl && currentPhysicalSheet ? (
                  <div
                    className="m-auto shadow-2xl bg-white ring-1 ring-black/10 relative flex-shrink-0"
                    style={{
                      width: `${previewPaperWidth * zoomLevel}px`,
                      aspectRatio: `${paperDimensions.width} / ${paperDimensions.height}`,
                    }}
                  >
                    <PdfSheet
                      file={selectedFile.pdfUrl}
                      pages={pagesOnCurrentSheet}
                      cols={nupGrid.cols}
                      rows={nupGrid.rows}
                      rotation={viewingBack ? backRotation(settings.duplex, settings.orientation, turnAxis) : 0}
                    />
                    {settings.duplex !== 'Simplex' && (
                      <div aria-hidden="true" className={selectedBindingAxis === 'vertical'
                        ? 'pointer-events-none absolute inset-y-0 -left-1 border-l-2 border-primary'
                        : 'pointer-events-none absolute inset-x-0 -top-1 border-t-2 border-primary'} />
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
            <div className="grid flex-1 md:grid-cols-3">
              <div className="flex items-center justify-center bg-[#E4E9EC] p-12 dark:bg-[#171B1E] md:col-span-2">
                <div className="relative aspect-[1/1.414] w-2/5 bg-white shadow-[0_14px_34px_-22px_rgba(16,36,58,0.45)]">
                  <div className="absolute inset-x-[12%] top-[12%] h-2 bg-[#0B3556]" />
                  <div className="absolute inset-x-[12%] top-[19%] h-1.5 bg-slate-300" />
                  <div className="absolute inset-x-[12%] top-[25%] space-y-2">
                    <div className="h-1 bg-slate-200" />
                    <div className="h-1 w-5/6 bg-slate-200" />
                    <div className="h-1 w-11/12 bg-slate-200" />
                  </div>
                  <div className="absolute bottom-[12%] left-[12%] h-1 w-16 bg-[#0B3556]" />
                  <span className="absolute -right-3 -top-3 rounded-md bg-[#0B3556] px-2 py-1 font-mono text-xs font-semibold text-white">A4</span>
                </div>
              </div>
              <div className="flex flex-col justify-center border-t border-border/60 px-6 py-8 md:border-l md:border-t-0 sm:px-8">
                <p className="text-xs font-semibold uppercase text-primary">Document required</p>
                <h2 className="mt-2 text-xl font-semibold text-foreground">Add a document to begin</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">The preview workspace will show the physical sheet, page arrangement, and selected queue before printing.</p>
                <Button onClick={handleBrowseFile} className="mt-6 w-full">
                  <Upload className="size-4" />
                  Choose document
                </Button>
                <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
                  <span className="rounded-md bg-muted px-2 py-2">Layout</span>
                  <span className="rounded-md bg-muted px-2 py-2">Output</span>
                  <span className="rounded-md bg-muted px-2 py-2">Queue</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar - Print Settings */}
        {selectedFile && (
        <aside className="min-h-0 overflow-y-auto bg-card max-md:overflow-visible md:col-span-1 xl:col-span-2">
          <div className="p-4 space-y-4">
            {/* Print options */}
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground px-1 mb-3">Print Options</h3>

              {/* Copies */}
              <div className="flex justify-between items-center py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                <label className="text-sm text-foreground">Copies</label>
                <div className="flex flex-1 items-center gap-2">
                  <Slider
                    value={[settings.copies]}
                    onValueChange={([val]) => setSettings({ ...settings, copies: val })}
                    min={1}
                    max={10}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-right text-sm font-semibold tabular-nums">{settings.copies}</span>
                </div>
              </div>

              <div className="space-y-2 rounded-lg px-3 py-2.5">
                <label htmlFor="duplex-mode" className="text-sm text-foreground">Two-sided printing</label>
                <select
                  id="duplex-mode"
                  aria-describedby="duplex-hint"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-medium"
                  value={settings.duplex}
                  onChange={(event) => setSettings(previous => ({
                    ...previous,
                    duplex: event.target.value as PrintSettings['duplex'],
                  }))}
                >
                  {Object.entries(DUPLEX_LABELS).map(([value, label]) => (
                    <option key={value} value={value} disabled={settings.booklet && value === 'Simplex'}>{label}</option>
                  ))}
                </select>
                <p id="duplex-hint" className="text-xs text-muted-foreground">
                  Long edge for portrait book-style reading; short edge for landscape book-style reading.
                  Changing orientation keeps your selected binding edge.
                </p>
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

              <label className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                Booklet (fold in half)
                <input type="checkbox" checked={settings.booklet} onChange={event => setSettings(previous => event.target.checked
                  ? { ...previous, booklet: true, pages_per_sheet: 2, orientation: 'Landscape', duplex: 'DuplexShortEdge' }
                  : { ...previous, booklet: false })} />
              </label>
              {settings.booklet && <p className="px-3 text-xs text-muted-foreground">Pages are reordered and padded with blanks for folding. Review both sides before printing.</p>}

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
                  disabled={settings.booklet}
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
                <div className="rounded-lg bg-primary/7 p-3">
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
        </aside>
        )}
      </div>

      {/* Bottom action bar */}
      {selectedFile && (
      <div className="bg-workspace px-4 py-3">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => navigate('/home')}
            className="text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handlePrintCurrent}
            disabled={selectedFile?.state !== 'ready' || !selectedPrinter || submitting}
            size="lg"
            className="px-6"
          >
            <Printer className="w-4 h-4 mr-2" />
            {settings.copies > 1 ? `Print ${settings.copies} Copies` : 'Print'}
          </Button>
          {fileQueue.length > 1 && (
            <Button
              onClick={handlePrintAll}
              disabled={fileQueue.length === 0 || fileQueue.some(file => file.state !== 'ready') || !selectedPrinter || submitting}
              size="lg"
              className="px-6 bg-success hover:bg-success-hover"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print All ({fileQueue.length})
            </Button>
          )}
        </div>
      </div>
      )}

      <FileErrorDialog
        open={errorDialog.open}
        onOpenChange={(open) => setErrorDialog((current) => ({ ...current, open }))}
        title={errorDialog.title}
        message={errorDialog.message}
        technicalDetails={errorDialog.technicalDetails}
      />

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
                {activeJobId && <JobProgress key={activeJobId} jobId={activeJobId} config={activeSshConfig} />}
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
                    {printDialog.error?.includes('Submission not confirmed') ? 'Submission Not Confirmed' : 'Print Job Failed'}
                  </AlertDialogTitle>
                </div>
                <AlertDialogDescription>
                  {printDialog.error}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onClick={() => {
                  setPrintDialog({ open: false, status: 'error' })
                  navigate('/jobs')
                }}>Check Jobs</AlertDialogAction>
                <AlertDialogAction onClick={() => setPrintDialog({ open: false, status: 'error' })}>
                  Close
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </PageScaffold>
  )
}
