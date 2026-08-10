import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { AppBackground } from '@/components/layout/AppBackground'
import { RBSidebar, RBSidebarProvider } from '@/components/reactbits/sidebar'
import { useBackgroundMonitor } from '@/hooks/useBackgroundMonitor'
import { safeOpenDevTools } from '@/lib/tauri-utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Menu } from 'lucide-react'
import { BrandLogo } from '@/components/common/brand'
import { ConnectionStatusBadge } from '@/components/common/ConnectionStatusBadge'

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const isAuthRoute = location.pathname === '/login'
  const isMobile = useIsMobile()
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
          : 'var(--rb-sidebar-width) minmax(0, 1fr)',
        transition: 'grid-template-columns 167ms var(--motion-standard)',
      }}
    >
      <RBSidebarProvider>
        {!isAuthRoute && !isMobile && (
          <RBSidebar>
            <AppSidebar />
          </RBSidebar>
        )}

        {!isAuthRoute && isMobile && (
          <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
            <SheetContent side="left" className="w-[248px] border-0 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <AppSidebar />
            </SheetContent>
          </Sheet>
        )}

        <main className="relative h-dvh min-w-0 overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden"
          >
            <AppBackground identity={isAuthRoute} />
          </div>

          {isAuthRoute ? (
            <div className="relative z-10 h-dvh">{children}</div>
          ) : (
            <div className="relative z-10 flex h-dvh p-2">
              <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-workspace">
                {isMobile && (
                  <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border/70 bg-card px-3">
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
                    <ConnectionStatusBadge />
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
              </section>
            </div>
          )}
        </main>
      </RBSidebarProvider>
    </div>
  )
}
