import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SSHConfig, PrintJob, Printer, PrinterGroup, DraftPrintJob, PrinterFilter, UserLocation } from '@/types/printer'
import { DEFAULT_PRINTER_QUEUE, groupPrinters, normalizePrintQueueName, PRINTERS } from '@/data/printers'

export type ConnectionStatus =
  | { type: 'disconnected' }
  | { type: 'connecting'; elapsedSeconds: number }
  | { type: 'connected'; connectedAt: Date }
  | { type: 'error'; message: string; lastAttempt: Date }

export interface SavedCredentials {
  serverType: 'stu' | 'stf'
  username: string
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
  setConnectedSession: (config: SSHConfig) => void
  clearConnectionSession: () => void

  // Saved login identity. Secrets are intentionally never persisted here.
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

  // Logout
  logout: () => void
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultPrinter: DEFAULT_PRINTER_QUEUE,
  cacheLocation: null,
  autoClearCache: false,
  maxCacheSize: 100,
}

const DEFAULT_PRINTER_FILTER: PrinterFilter = {
  building: null,
  floor: null,
  sortBy: 'default',
}

type PersistedPrinterState = Partial<
  Pick<
    PrinterState,
    'selectedPrinter' | 'savedCredentials' | 'settings' | 'draftJobs' | 'userLocation' | 'printerFilter'
  >
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeSavedCredentials(value: unknown): SavedCredentials | null {
  if (!isRecord(value)) return null

  const { serverType, username } = value
  if ((serverType !== 'stu' && serverType !== 'stf') || typeof username !== 'string' || !username.trim()) {
    return null
  }

  return {
    serverType,
    username: username.trim(),
    rememberMe: true,
  }
}

function sanitizePersistedState(value: unknown): PersistedPrinterState {
  if (!isRecord(value)) return {}

  return {
    selectedPrinter: (value.selectedPrinter as Printer | null | undefined) ?? null,
    savedCredentials: sanitizeSavedCredentials(value.savedCredentials),
    settings: isRecord(value.settings)
      ? {
          ...DEFAULT_SETTINGS,
          ...value.settings,
          defaultPrinter: normalizePrintQueueName(value.settings.defaultPrinter as string | null | undefined),
        }
      : DEFAULT_SETTINGS,
    draftJobs: Array.isArray(value.draftJobs) ? (value.draftJobs as DraftPrintJob[]) : [],
    userLocation: (value.userLocation as UserLocation | null | undefined) ?? null,
    printerFilter: isRecord(value.printerFilter)
      ? { ...DEFAULT_PRINTER_FILTER, ...value.printerFilter }
      : DEFAULT_PRINTER_FILTER,
  }
}

export const usePrinterStore: UseBoundStore<StoreApi<PrinterState>> = create<PrinterState>()(
  persist<PrinterState, [], [], PersistedPrinterState>(
    (set, get) => ({
      // SSH Configuration
      sshConfig: null,
      setConnectedSession: (config: SSHConfig) =>
        set({
          sshConfig: config,
          connectionStatus: { type: 'connected', connectedAt: new Date() },
        }),
      clearConnectionSession: () =>
        set({
          sshConfig: null,
          connectionStatus: { type: 'disconnected' },
        }),

      // Saved Credentials
      savedCredentials: null,
      setSavedCredentials: (credentials: SavedCredentials | null) => set({ savedCredentials: credentials }),
      clearSavedCredentials: () => set({ savedCredentials: null }),

      // App Settings
      settings: DEFAULT_SETTINGS,
      setSettings: (newSettings: Partial<AppSettings>) =>
        set((state) => ({
          settings: {
            ...state.settings,
            ...newSettings,
            ...(Object.prototype.hasOwnProperty.call(newSettings, 'defaultPrinter')
              ? { defaultPrinter: normalizePrintQueueName(newSettings.defaultPrinter) }
              : {}),
          },
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
      printerFilter: DEFAULT_PRINTER_FILTER,
      setPrinterFilter: (filter: Partial<PrinterFilter>) =>
        set((state) => ({
          printerFilter: { ...state.printerFilter, ...filter },
        })),
      clearPrinterFilter: () =>
        set({
          printerFilter: DEFAULT_PRINTER_FILTER,
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

      // Logout
      logout: () =>
        set({
          sshConfig: null,
          savedCredentials: null,
          connectionStatus: { type: 'disconnected' },
          selectedPrinter: null,
          currentFile: null,
          currentFilePath: null,
        }),
    }),
    {
      name: 'printer-storage',
      version: 2,
      partialize: (state) => ({
        selectedPrinter: state.selectedPrinter,
        savedCredentials: state.savedCredentials,
        settings: state.settings,
        draftJobs: state.draftJobs,
        userLocation: state.userLocation,
        printerFilter: state.printerFilter,
      }),
      migrate: (persistedState) => sanitizePersistedState(persistedState),
      merge: (persistedState, currentState) => {
        const safePersistedState = sanitizePersistedState(persistedState)
        return {
          ...currentState,
          ...safePersistedState,
          sshConfig: null,
          connectionStatus: { type: 'disconnected' },
          printerGroups: groupPrinters(currentState.printers),
        }
      },
    }
  )
)
