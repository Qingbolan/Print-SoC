import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SSHConfig, PrintJob, Printer, PrinterGroup } from '@/types/printer'
import { groupPrinters, PRINTERS } from '@/data/printers'

export type ConnectionStatus =
  | { type: 'disconnected' }
  | { type: 'connecting'; elapsedSeconds: number }
  | { type: 'connected'; connectedAt: Date }
  | { type: 'error'; message: string; lastAttempt: Date }

export interface SavedCredentials {
  serverType: 'stu' | 'stf'
  username: string
  password: string
  rememberMe: boolean
}

export interface AppSettings {
  defaultPrinter: string | null
  cacheLocation: string | null
  autoClearCache: boolean
  maxCacheSize: number // in MB
}

interface PrinterState {
  // SSH Configuration
  sshConfig: SSHConfig | null
  setSshConfig: (config: SSHConfig | null) => void

  // Saved Credentials for auto-login
  savedCredentials: SavedCredentials | null
  setSavedCredentials: (credentials: SavedCredentials | null) => void
  clearSavedCredentials: () => void

  // App Settings
  settings: AppSettings
  setSettings: (settings: Partial<AppSettings>) => void

  // Print Jobs
  printJobs: PrintJob[]
  setPrintJobs: (jobs: PrintJob[]) => void
  addPrintJob: (job: PrintJob) => void
  updatePrintJob: (jobId: string, updates: Partial<PrintJob>) => void
  removePrintJob: (jobId: string) => void
  clearAllJobs: () => void

  // Printers
  printers: Printer[]
  setPrinters: (printers: Printer[]) => void
  selectedPrinter: Printer | null
  setSelectedPrinter: (printer: Printer | null) => void

  // Printer Groups
  printerGroups: PrinterGroup[]
  getPrinterGroups: () => PrinterGroup[]
  updatePrinterStatus: (printerId: string, status: Printer['status'], queueCount?: number) => void

  // Printer refresh state
  isRefreshing: boolean
  setIsRefreshing: (refreshing: boolean) => void
  lastRefreshTime: Date | null
  setLastRefreshTime: (time: Date | null) => void

  // Current upload/print state
  currentFile: File | null
  currentFilePath: string | null
  setCurrentFile: (file: File | null, path: string | null) => void

  // Connection State
  connectionStatus: ConnectionStatus
  setConnectionStatus: (status: ConnectionStatus) => void

  // Legacy UI State (kept for compatibility)
  isConnected: boolean
  setIsConnected: (connected: boolean) => void

  // Logout
  logout: () => void
}

export const usePrinterStore = create<PrinterState>()(
  persist(
    (set) => ({
      // SSH Configuration
      sshConfig: null,
      setSshConfig: (config) => set({ sshConfig: config }),

      // Saved Credentials
      savedCredentials: null,
      setSavedCredentials: (credentials) => set({ savedCredentials: credentials }),
      clearSavedCredentials: () => set({ savedCredentials: null }),

      // App Settings
      settings: {
        defaultPrinter: null,
        cacheLocation: null,
        autoClearCache: false,
        maxCacheSize: 100, // 100MB default
      },
      setSettings: (newSettings) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        })),

      // Print Jobs
      printJobs: [],
      setPrintJobs: (jobs) => set({ printJobs: jobs }),
      addPrintJob: (job) =>
        set((state) => ({ printJobs: [job, ...state.printJobs] })),
      updatePrintJob: (jobId, updates) =>
        set((state) => ({
          printJobs: state.printJobs.map((job) =>
            job.id === jobId ? { ...job, ...updates } : job
          ),
        })),
      removePrintJob: (jobId) =>
        set((state) => ({
          printJobs: state.printJobs.filter((job) => job.id !== jobId),
        })),
      clearAllJobs: () => set({ printJobs: [] }),

      // Printers - initialized with all printers
      printers: PRINTERS,
      setPrinters: (printers) => {
        const groups = groupPrinters(printers)
        set({ printers, printerGroups: groups })
      },
      selectedPrinter: null,
      setSelectedPrinter: (printer) => set({ selectedPrinter: printer }),

      // Printer Groups - initialized with grouped printers
      printerGroups: groupPrinters(PRINTERS),
      getPrinterGroups: () => {
        const state = usePrinterStore.getState()
        return groupPrinters(state.printers)
      },
      updatePrinterStatus: (printerId, status, queueCount) =>
        set((state) => {
          const updatedPrinters = state.printers.map((printer) =>
            printer.id === printerId
              ? { ...printer, status, queue_count: queueCount ?? printer.queue_count }
              : printer
          )
          const groups = groupPrinters(updatedPrinters)
          return { printers: updatedPrinters, printerGroups: groups }
        }),

      // Printer refresh state
      isRefreshing: false,
      setIsRefreshing: (refreshing) => set({ isRefreshing: refreshing }),
      lastRefreshTime: null,
      setLastRefreshTime: (time) => set({ lastRefreshTime: time }),

      // Current upload/print state
      currentFile: null,
      currentFilePath: null,
      setCurrentFile: (file, path) =>
        set({ currentFile: file, currentFilePath: path }),

      // Connection State
      connectionStatus: { type: 'disconnected' },
      setConnectionStatus: (status) => set({ connectionStatus: status }),

      // UI State
      isConnected: false,
      setIsConnected: (connected) => set({ isConnected: connected }),

      // Logout
      logout: () =>
        set({
          sshConfig: null,
          savedCredentials: null,
          connectionStatus: { type: 'disconnected' },
          isConnected: false,
          selectedPrinter: null,
          currentFile: null,
          currentFilePath: null,
        }),
    }),
    {
      name: 'printer-storage',
      partialize: (state) => ({
        sshConfig: state.sshConfig,
        selectedPrinter: state.selectedPrinter,
        savedCredentials: state.savedCredentials,
        settings: state.settings,
      }),
    }
  )
)
