import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { AppBackground } from '@/components/layout/AppBackground'
import { RBSidebar } from '@/components/reactbits/sidebar'
import { useBackgroundMonitor } from '@/hooks/useBackgroundMonitor'
import { isTauriAvailable, safeOpenDevTools } from '@/lib/tauri-utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Menu } from 'lucide-react'
import { BrandLogo } from '@/components/common/brand'
import { ConnectionStatusBadge } from '@/components/common/ConnectionStatusBadge'

const pageTitles: Record<string, string> = {
  '/home': 'Print workbench',
  '/printer': 'Printer directory',
  '/jobs': 'Print queue',
  '/help': 'Help centre',
  '/settings': 'Settings',
}

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const isAuthRoute = location.pathname === '/login'
  const isMobile = useIsMobile()
  const showWindowBar = !isMobile || isTauriAvailable()
  const windowTitle = location.pathname.startsWith('/preview')
    ? 'Print preview'
    : pageTitles[location.pathname] ?? 'Print@SoC'
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)

  useBackgroundMonitor()

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const isDevToolsShortcut =
        (e.key === 'I' && e.shiftKey && (e.metaKey || e.ctrlKey)) ||
        e.key === 'F12'

      if (isDevToolsShortcut) {
        e.preventDefault()
        await safeOpenDevTools()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    setMobileNavigationOpen(false)
  }, [location.pathname])

  return (
    <div
      className="app-shell h-dvh overflow-hidden bg-sidebar font-sans antialiased"
      data-auth-route={isAuthRoute || undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: isAuthRoute
          ? 'minmax(0, 1fr)'
          : isMobile
            ? 'minmax(0, 1fr)'
            : 'clamp(5.25rem, 6vw, 6rem) minmax(0, 1fr)',
        transition: 'grid-template-columns 167ms var(--motion-standard)',
      }}
    >
      {!isAuthRoute && !isMobile && (
        <RBSidebar>
          <AppSidebar />
        </RBSidebar>
      )}

      {!isAuthRoute && isMobile && (
        <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
          <SheetContent
            side="left"
            className="w-4/5 border-0 p-0 text-white sm:w-72 [&_[data-slot=sheet-close]]:hover:bg-white/10"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <AppSidebar mode="drawer" />
          </SheetContent>
        </Sheet>
      )}

      <main className="relative flex h-dvh min-w-0 flex-col overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <AppBackground identity={isAuthRoute} />
        </div>

        {isAuthRoute ? (
          <>
            {isTauriAvailable() && (
              <div
                data-tauri-drag-region
                className="absolute inset-x-0 top-0 z-20 h-11 select-none"
                aria-hidden="true"
              />
            )}
            <div className="relative z-10 h-dvh overflow-y-auto">{children}</div>
          </>
        ) : (
          <>
            {showWindowBar && (
              <div
                data-tauri-drag-region
                className="relative z-20 flex h-11 shrink-0 select-none items-center justify-center px-4 text-xs font-medium text-sidebar-foreground/80"
              >
                <span data-tauri-drag-region>{windowTitle}</span>
              </div>
            )}
            <div className="relative z-10 flex min-h-0 flex-1 px-2 pb-2">
              <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-workspace">
                {isMobile && (
                  <div className="flex h-14 shrink-0 items-center gap-3 bg-card px-3">
                    <Button
                      variant="secondary"
                      size="icon"
                      aria-label="Open navigation"
                      onClick={() => setMobileNavigationOpen(true)}
                    >
                      <Menu />
                    </Button>
                    <BrandLogo
                      className="min-w-0 flex-1"
                      iconClassName="size-7"
                      subtitle="NUS SoC"
                    />
                    <ConnectionStatusBadge compact />
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
