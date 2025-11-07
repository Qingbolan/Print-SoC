import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppSidebar } from '@/components/app-sidebar'
import { RBSidebarProvider, RBSidebar } from '@/components/reactbits/sidebar'
import { I18nProvider } from '@/lib/i18n'
import { AccentColorProvider } from '@/lib/accent-color'
import { ThemeProvider } from '@/lib/theme-context'
import { FluentProviderWrapper } from '@/components/providers/fluent-provider'
import { AntdProvider } from '@/components/providers/antd-provider'
import { PageBreadcrumb } from '@/components/PageBreadcrumb'
import { safeOpenDevTools } from '@/lib/tauri-utils'

// Pages
import ModernLoginPageV2 from '@/pages/ModernLoginPageV2'
import ModernHomePageV2 from '@/pages/ModernHomePageV2'
import ModernPreviewPage from '@/pages/ModernPreviewPage'
import PrintersPage from '@/pages/PrintersPage'
import PrintQueuePage from '@/pages/PrintQueuePage'
import JobsPage from '@/pages/JobsPage'
import HelpPage from '@/pages/HelpPage'
import SettingsPage from '@/pages/SettingsPage'

function AppLayout({ children }: { children: React.ReactNode }) {

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Check for Cmd+Shift+I (Mac) or Ctrl+Shift+I (Windows/Linux) or F12
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

  return (
    <div className="font-sans antialiased h-dvh overflow-hidden">
      <ThemeProvider>
        <AntdProvider>
          <FluentProviderWrapper>
            <AccentColorProvider>
              <I18nProvider>
                <RBSidebarProvider>
                  {/* Sidebar - ReactBits style */}
                  <RBSidebar>
                    <AppSidebar />
                  </RBSidebar>

                  {/* Main content: independent scroll container with CSS var offset */}
                  <main
                    className="h-dvh overflow-y-auto overscroll-y-contain relative"
                    style={{ marginLeft: 'var(--rb-sidebar-width)' }}
                  >
                    {/* Modern Gradient Background Layer - Theme Aware */}
                    <div
                      className="fixed inset-0 pointer-events-none z-0 overflow-hidden bg-background"
                      style={{ left: 'var(--rb-sidebar-width)' }}
                    >
                      {/* Base gradient with theme support */}
                      <div className="absolute inset-0 bg-gradient-to-br from-background via-muted/30 to-background" />

                      {/* Animated gradient orbs - more visible in both themes */}
                      <div
                        className="absolute top-0 right-0 h-[600px] w-[600px] rounded-full bg-primary/12 dark:bg-primary/20 blur-3xl"
                        style={{
                          animation: 'float 20s ease-in-out infinite',
                          transform: 'translate(20%, -20%)'
                        }}
                      />
                      <div
                        className="absolute bottom-0 left-0 h-[500px] w-[500px] rounded-full bg-accent/10 dark:bg-accent/18 blur-3xl"
                        style={{
                          animation: 'float 25s ease-in-out infinite reverse',
                          animationDelay: '5s',
                          transform: 'translate(-20%, 20%)'
                        }}
                      />
                      <div
                        className="absolute top-1/3 left-1/2 h-[400px] w-[400px] rounded-full bg-success/8 dark:bg-success/15 blur-3xl"
                        style={{
                          animation: 'float 30s ease-in-out infinite',
                          animationDelay: '10s',
                          transform: 'translate(-50%, -50%)'
                        }}
                      />

                      {/* Radial gradient overlay */}
                      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/8 via-transparent to-transparent dark:from-primary/15" />
                    </div>

                    {/* Acrylic Material Layer - Theme Aware */}
                    <div
                      className="fixed inset-0 pointer-events-none z-[1] bg-background/80 dark:bg-background/70"
                      style={{
                        left: 'var(--rb-sidebar-width)',
                        backdropFilter: 'blur(60px) saturate(150%)',
                        WebkitBackdropFilter: 'blur(60px) saturate(150%)',
                      }}
                    >
                      {/* Noise texture - visible in both themes */}
                      <div
                        className="absolute inset-0 opacity-[0.06] dark:opacity-[0.08]"
                        style={{
                          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='3.5' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
                          backgroundSize: '180px 180px',
                          mixBlendMode: 'soft-light',
                        }}
                      />
                    </div>

                    {/* Main content area - above acrylic layer */}
                    <div className="relative z-10 h-dvh flex flex-col">
                      <PageBreadcrumb />
                      <div className="flex-1 min-h-0">
                        {children}
                      </div>
                    </div>
                  </main>
                </RBSidebarProvider>
              </I18nProvider>
            </AccentColorProvider>
          </FluentProviderWrapper>
        </AntdProvider>
      </ThemeProvider>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<ModernLoginPageV2 />} />
          <Route path="/home" element={<ModernHomePageV2 />} />
          <Route path="/preview" element={<ModernPreviewPage />} />
          <Route path="/printer" element={<PrintQueuePage />} />
          <Route path="/printers" element={<PrintersPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  )
}
