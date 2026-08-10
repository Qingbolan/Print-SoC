import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { NetworkCheckProvider } from '@/components/providers/NetworkCheckProvider'
import { I18nProvider } from '@/lib/i18n'
import { ThemeProvider } from '@/lib/theme-context'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <NetworkCheckProvider>
      <BrowserRouter>
        <ThemeProvider>
          <I18nProvider>{children}</I18nProvider>
        </ThemeProvider>
      </BrowserRouter>
    </NetworkCheckProvider>
  )
}
