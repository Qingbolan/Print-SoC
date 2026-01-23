import { useState, useEffect, useCallback, useRef } from 'react'
import { safeInvoke, isDebugMode, isTauriAvailable } from '@/lib/tauri-utils'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { WifiOff } from 'lucide-react'

// Helper to hide splash screen
const hideSplash = () => {
  const win = window as unknown as { hideSplash?: () => void }
  win.hideSplash?.()
}

export function NetworkCheckProvider({ children }: { children: React.ReactNode }) {
  const [showDialog, setShowDialog] = useState(false)
  const hasChecked = useRef(false)

  // Check network connectivity
  const checkNetwork = useCallback(async (): Promise<boolean> => {
    if (isDebugMode() || !isTauriAvailable()) {
      return true
    }
    try {
      const result = await safeInvoke<boolean>('check_network_connectivity')
      return result.success && result.data === true
    } catch {
      return false
    }
  }, [])

  // Exit the application
  const exitApp = useCallback(async () => {
    await safeInvoke('exit_app')
  }, [])

  // Initial network check
  useEffect(() => {
    if (hasChecked.current) return
    hasChecked.current = true

    checkNetwork().then((connected) => {
      if (!connected) {
        hideSplash() // Hide splash to show error dialog
        setShowDialog(true)
      }
      // If connected, LoginPage will hide splash when ready
    })
  }, [checkNetwork])

  return (
    <>
      {children}

      <AlertDialog open={showDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-3 rounded-full bg-destructive/10">
                <WifiOff className="w-6 h-6 text-destructive" />
              </div>
              <AlertDialogTitle className="text-xl">
                Network Required
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Cannot connect to NUS SoC network. This app requires NUS internal network access.
                </p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li>Connect to NUS campus WiFi</li>
                  <li>Or use NUS VPN</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="destructive" onClick={exitApp}>
              Exit
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
