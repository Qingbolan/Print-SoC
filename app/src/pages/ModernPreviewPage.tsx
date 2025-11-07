import { useState, useEffect, useMemo, useCallback } from 'react'
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

  // Initialize with file from location state
  useEffect(() => {
    if (initialFilePath) {
      addFileToQueue(initialFilePath, initialPdfInfo)
    }
    setPrinters(PRINTERS)
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
      {/* Main content - 3 column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - File Queue */}
        <div className="w-72 border-r border-border/50 flex flex-col">
          {/* Upload area */}
          <div className="p-4 border-b border-border/50">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              className={cn(
                'border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer',
                isDragging
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50'
              )}
              onClick={handleFileSelect}
            >
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">Add Files</p>
              <p className="text-xs text-muted-foreground mt-1">
                Click or drop PDF files
              </p>
            </div>
          </div>

          {/* File list */}
          <div className="flex-1 overflow-y-auto p-2">
            <div className="space-y-1">
              {fileQueue.map((file) => (
                <div
                  key={file.id}
                  onClick={() => setSelectedFileId(file.id)}
                  className={cn(
                    'group relative p-3 rounded-lg border cursor-pointer transition-all',
                    selectedFileId === file.id
                      ? 'bg-primary/10 border-primary'
                      : 'border-border hover:bg-accent'
                  )}
                >
                  <div className="flex items-start gap-2">
                    <FileText className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {file.name}
                      </p>
                      {file.loading && (
                        <p className="text-xs text-muted-foreground">Loading...</p>
                      )}
                      {file.error && (
                        <p className="text-xs text-red-500">{file.error}</p>
                      )}
                      {file.pdfInfo && !file.loading && (
                        <p className="text-xs text-muted-foreground">
                          {file.pdfInfo.num_pages} pages
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeFile(file.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 h-6 w-6 p-0"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Queue summary */}
          <div className="p-4 border-t border-border/50">
            <div className="text-sm text-muted-foreground">
              {fileQueue.length} {fileQueue.length === 1 ? 'file' : 'files'} in queue
            </div>
          </div>
        </div>

        {/* Center - PDF Preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedFile ? (
            <>
              {/* Page navigation at top */}
              <div className="flex items-center justify-between px-6 py-3 border-b border-border/50 bg-card/50">
                <div className="flex items-center gap-4">
                  <Button
                    onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                    disabled={pageNumber <= 1}
                    variant="outline"
                    size="sm"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Previous
                  </Button>
                  <span className="text-sm font-medium">
                    Page {pageNumber} of {numPages}
                  </span>
                  <Button
                    onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
                    disabled={pageNumber >= numPages}
                    variant="outline"
                    size="sm"
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>

                <div className="text-sm text-muted-foreground">
                  {selectedFile.name}
                </div>
              </div>

              {/* PDF viewer */}
              <div className="flex-1 overflow-y-auto bg-muted/20 p-6">
                <div className="max-w-3xl mx-auto">
                  {selectedFile.loading ? (
                    <div className="flex items-center justify-center py-32">
                      <div className="text-center">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-4" />
                        <p className="text-sm text-muted-foreground">Loading PDF...</p>
                      </div>
                    </div>
                  ) : selectedFile.pdfUrl ? (
                    <div className="bg-card shadow-lg rounded-lg border border-border/50 overflow-hidden">
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
                          width={650}
                          renderTextLayer={true}
                          renderAnnotationLayer={true}
                        />
                      </Document>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-32">
                      <div className="text-center text-muted-foreground">
                        <AlertCircle className="w-12 h-12 mx-auto mb-4" />
                        <p>Failed to load PDF</p>
                      </div>
                    </div>
                  )}
                </div>
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
          <div className="text-sm text-muted-foreground">
            {fileQueue.length} {fileQueue.length === 1 ? 'file' : 'files'} ready to print
          </div>

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
            <Button
              onClick={handlePrintAll}
              disabled={fileQueue.length === 0 || !selectedPrinter || submitting}
              className="bg-green-600 hover:bg-green-700"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print All ({fileQueue.length})
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
