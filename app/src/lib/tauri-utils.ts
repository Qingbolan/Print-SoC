/**
 * Tauri API utilities for safe browser/Tauri environment handling
 */

import type { ApiResponse } from '@/types/printer'

/**
 * Check if running in Tauri environment
 */
export function isTauriAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window
}

/**
 * Check if running in debug/offline mode
 */
export function isDebugMode(): boolean {
  return import.meta.env.VITE_DEBUG_OFFLINE === 'true'
}

/**
 * Safe wrapper for Tauri invoke function
 * Returns mock data in browser/debug mode
 */
export async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<ApiResponse<T>> {
  // If in debug mode and Tauri is not available, return mock success
  if (isDebugMode() && !isTauriAvailable()) {
    console.log(`[Debug Mode] Mock invoke: ${command}`, args)

    // Return appropriate mock data based on command
    return getMockResponse<T>(command)
  }

  // If Tauri is not available and not in debug mode, return error
  if (!isTauriAvailable()) {
    return {
      success: false,
      error: 'Tauri API not available. Please run the app using "npm run tauri:dev"',
    }
  }

  // Normal Tauri invoke
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke(command, args)
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Get mock response for debug mode
 */
function getMockResponse<T>(command: string): ApiResponse<T> {
  switch (command) {
    case 'print_get_all_jobs':
      return {
        success: true,
        data: [] as T, // Empty array for jobs
      }

    case 'print_get_printers':
      return {
        success: true,
        data: [
          { name: 'psts', queue: 'psts', location: 'COM1-B109 (Student)', color: true },
          { name: 'pstb', queue: 'pstb', location: 'COM1-B109 (Student)', color: false },
        ] as T,
      }

    case 'pdf_get_info':
      return {
        success: true,
        data: {
          pages: 10,
          title: 'Sample PDF',
          size: 1024000,
        } as T,
      }

    case 'ssh_test_connection':
      return {
        success: true,
        data: 'Connection successful (mock)' as T,
      }

    default:
      return {
        success: true,
        data: null as T,
      }
  }
}

/**
 * Safe wrapper for Tauri dialog open function
 */
export async function safeDialogOpen(options: {
  multiple?: boolean
  filters?: Array<{ name: string; extensions: string[] }>
}): Promise<string | string[] | null> {
  // If in debug mode and Tauri is not available, return null (cancelled)
  if (isDebugMode() && !isTauriAvailable()) {
    console.log('[Debug Mode] Dialog open cancelled (mock)')
    return null
  }

  // If Tauri is not available, show error
  if (!isTauriAvailable()) {
    console.error('Tauri dialog API not available')
    return null
  }

  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    return await open(options)
  } catch (error) {
    console.error('Error opening dialog:', error)
    return null
  }
}

/**
 * Safe wrapper for getCurrentWebviewWindow
 */
export function safeGetCurrentWebviewWindow() {
  if (!isTauriAvailable()) {
    console.warn('Tauri webview API not available')
    return null
  }

  try {
    const { getCurrentWebviewWindow } = require('@tauri-apps/api/webviewWindow')
    return getCurrentWebviewWindow()
  } catch (error) {
    console.error('Error getting webview window:', error)
    return null
  }
}

/**
 * Safe wrapper for opening DevTools
 */
export async function safeOpenDevTools(): Promise<boolean> {
  const window = safeGetCurrentWebviewWindow()

  if (!window) {
    // If running in browser, try browser's native console
    if (typeof console !== 'undefined') {
      console.log('[Debug Mode] DevTools not available in browser mode. Use browser DevTools instead.')
    }
    return false
  }

  try {
    // @ts-ignore - openDevtools exists but may not be in types
    if (window.openDevtools) {
      // @ts-ignore
      await window.openDevtools()
      return true
    }
    return false
  } catch (error) {
    console.error('Failed to open DevTools:', error)
    return false
  }
}
