import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SSHConfig, PrintJob, Printer, PrinterGroup, DraftPrintJob, PrinterFilter, UserLocation } from '@/types/printer'
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

  // Draft Jobs (unsaved print jobs)
  draftJobs: DraftPrintJob[]
  addDraftJob: (draft: DraftPrintJob) => void
  updateDraftJob: (draftId: string, updates: Partial<DraftPrintJob>) => void
  removeDraftJob: (draftId: string) => void
  clearAllDrafts: () => void

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

  // Printer Filter State
  printerFilter: PrinterFilter
  setPrinterFilter: (filter: Partial<PrinterFilter>) => void
  clearPrinterFilter: () => void

  // User Location (for distance-based sorting)
  userLocation: UserLocation | null
  setUserLocation: (location: UserLocation | null) => void

  // Quick print - pre-selected printer for navigation
  quickPrintPrinter: string | null
  setQuickPrintPrinter: (printerId: string | null) => void

  // Connection State
  connectionStatus: ConnectionStatus
  setConnectionStatus: (status: ConnectionStatus) => void

  // Legacy UI State (kept for compatibility)
  isConnected: boolean
  setIsConnected: (connected: boolean) => void

  // Logout
  logout: () => void
}

export const usePrinterStore: UseBoundStore<StoreApi<PrinterState>> = create<PrinterState>()(
  persist(
    (set, get) => ({
      // SSH Configuration
      sshConfig: null,
      setSshConfig: (config: SSHConfig | null) => set({ sshConfig: config }),

      // Saved Credentials
      savedCredentials: null,
      setSavedCredentials: (credentials: SavedCredentials | null) => set({ savedCredentials: credentials }),
      clearSavedCredentials: () => set({ savedCredentials: null }),

      // App Settings
      settings: {
        defaultPrinter: null,
        cacheLocation: null,
        autoClearCache: false,
        maxCacheSize: 100, // 100MB default
      },
      setSettings: (newSettings: Partial<AppSettings>) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        })),

      // Print Jobs
      printJobs: [],
      setPrintJobs: (jobs: PrintJob[]) => set({ printJobs: jobs }),
      addPrintJob: (job: PrintJob) =>
        set((state) => ({ printJobs: [job, ...state.printJobs] })),
      updatePrintJob: (jobId: string, updates: Partial<PrintJob>) =>
        set((state) => ({
          printJobs: state.printJobs.map((job) =>
            job.id === jobId ? { ...job, ...updates } : job
          ),
        })),
      removePrintJob: (jobId: string) =>
        set((state) => ({
          printJobs: state.printJobs.filter((job) => job.id !== jobId),
        })),
      clearAllJobs: () => set({ printJobs: [] }),

      // Draft Jobs
      draftJobs: [],
      addDraftJob: (draft: DraftPrintJob) =>
        set((state) => {
          // Replace existing draft with same file path, or add new one
          const existingIndex = state.draftJobs.findIndex(d => d.file_path === draft.file_path)
          if (existingIndex >= 0) {
            const newDrafts = [...state.draftJobs]
            newDrafts[existingIndex] = draft
            return { draftJobs: newDrafts }
          }
          return { draftJobs: [draft, ...state.draftJobs] }
        }),
      updateDraftJob: (draftId: string, updates: Partial<DraftPrintJob>) =>
        set((state) => ({
          draftJobs: state.draftJobs.map((draft) =>
            draft.id === draftId ? { ...draft, ...updates, updated_at: new Date().toISOString() } : draft
          ),
        })),
      removeDraftJob: (draftId: string) =>
        set((state) => ({
          draftJobs: state.draftJobs.filter((draft) => draft.id !== draftId),
        })),
      clearAllDrafts: () => set({ draftJobs: [] }),

      // Printers - initialized with all printers
      printers: PRINTERS,
      setPrinters: (printers: Printer[]) => {
        const groups = groupPrinters(printers)
        set({ printers, printerGroups: groups })
      },
      selectedPrinter: null,
      setSelectedPrinter: (printer: Printer | null) => set({ selectedPrinter: printer }),

      // Printer Groups - initialized with grouped printers
      printerGroups: groupPrinters(PRINTERS),
      getPrinterGroups: (): PrinterGroup[] => {
        const state = get()
        return groupPrinters(state.printers)
      },
      updatePrinterStatus: (printerId: string, status: Printer['status'], queueCount?: number) =>
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
      setIsRefreshing: (refreshing: boolean) => set({ isRefreshing: refreshing }),
      lastRefreshTime: null,
      setLastRefreshTime: (time: Date | null) => set({ lastRefreshTime: time }),

      // Current upload/print state
      currentFile: null,
      currentFilePath: null,
      setCurrentFile: (file: File | null, path: string | null) =>
        set({ currentFile: file, currentFilePath: path }),

      // Printer Filter State
      printerFilter: {
        building: null,
        floor: null,
        sortBy: 'default',
      },
      setPrinterFilter: (filter: Partial<PrinterFilter>) =>
        set((state) => ({
          printerFilter: { ...state.printerFilter, ...filter },
        })),
      clearPrinterFilter: () =>
        set({
          printerFilter: {
            building: null,
            floor: null,
            sortBy: 'default',
          },
        }),

      // User Location
      userLocation: null,
      setUserLocation: (location: UserLocation | null) => set({ userLocation: location }),

      // Quick print
      quickPrintPrinter: null,
      setQuickPrintPrinter: (printerId: string | null) => set({ quickPrintPrinter: printerId }),

      // Connection State
      connectionStatus: { type: 'disconnected' },
      setConnectionStatus: (status: ConnectionStatus) => set({ connectionStatus: status }),

      // UI State
      isConnected: false,
      setIsConnected: (connected: boolean) => set({ isConnected: connected }),

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
        draftJobs: state.draftJobs,
        userLocation: state.userLocation,
        printerFilter: state.printerFilter,
      }),
    }
  )
)
