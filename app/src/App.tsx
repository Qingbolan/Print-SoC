import { AppProviders } from '@/app/AppProviders'
import { AppRoutes } from '@/app/AppRoutes'
import { AppShell } from '@/app/AppShell'

export default function App() {
  return (
    <AppProviders>
      <AppShell>
        <AppRoutes />
      </AppShell>
    </AppProviders>
  )
}
