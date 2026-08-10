import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Spinner } from '@/components/ui/spinner'

const DebugPage = lazy(() => import('@/pages/DebugPage'))
const HelpPage = lazy(() => import('@/pages/HelpPage'))
const HomePage = lazy(() => import('@/pages/HomePage'))
const JobsPage = lazy(() => import('@/pages/JobsPage'))
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const PreviewPage = lazy(() => import('@/pages/PreviewPage'))
const PrintersPage = lazy(() => import('@/pages/PrintersPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))

function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="h-6 w-6 text-primary" />
    </div>
  )
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/preview/:sessionId?" element={<PreviewPage />} />
        <Route path="/printer" element={<PrintersPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/debug" element={<DebugPage />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </Suspense>
  )
}
