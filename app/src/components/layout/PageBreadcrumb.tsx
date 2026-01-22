import { useLocation, Link } from 'react-router-dom'
import { Home, Printer, FileText, HelpCircle, Settings, Eye, ListOrdered } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { ConnectionStatusBadge } from '@/components/common/ConnectionStatusBadge'

interface RouteConfig {
  name: string
  icon?: React.ReactNode
}

const routeConfig: Record<string, RouteConfig> = {
  '/': { name: 'Home', icon: <Home className="w-3.5 h-3.5" /> },
  '/home': { name: 'Home', icon: <Home className="w-3.5 h-3.5" /> },
  '/login': { name: 'Login' },
  '/printer': { name: 'Printer', icon: <Printer className="w-3.5 h-3.5" /> },
  '/queue': { name: 'Print Queue', icon: <ListOrdered className="w-3.5 h-3.5" /> },
  '/jobs': { name: 'Print Jobs', icon: <FileText className="w-3.5 h-3.5" /> },
  '/help': { name: 'Help', icon: <HelpCircle className="w-3.5 h-3.5" /> },
  '/settings': { name: 'Settings', icon: <Settings className="w-3.5 h-3.5" /> },
  '/preview': { name: 'Preview', icon: <Eye className="w-3.5 h-3.5" /> },
}

export function PageBreadcrumb() {
  const location = useLocation()
  const pathSegments = location.pathname.split('/').filter(Boolean)

  // Build breadcrumb items from path
  const breadcrumbItems: Array<{ path: string; name: string; icon?: React.ReactNode }> = []

  // Always add home as first item if we're not on home page
  if (location.pathname !== '/home' && location.pathname !== '/') {
    breadcrumbItems.push({
      path: '/home',
      name: routeConfig['/home'].name,
      icon: routeConfig['/home'].icon,
    })
  }

  // Build path progressively
  let currentPath = ''
  pathSegments.forEach((segment, index) => {
    currentPath += `/${segment}`
    const config = routeConfig[currentPath]

    if (config) {
      breadcrumbItems.push({
        path: currentPath,
        name: config.name,
        icon: config.icon,
      })
    } else {
      // Handle dynamic segments (e.g., /preview/:sessionId)
      const parentPath = '/' + pathSegments.slice(0, index).join('/')
      const parentConfig = routeConfig[parentPath]
      if (parentConfig && index > 0) {
        // This is a dynamic segment after a known route
        breadcrumbItems.push({
          path: currentPath,
          name: segment, // Show the session ID or dynamic value
          icon: undefined,
        })
      }
    }
  })

  // Don't show breadcrumb on login page or home page (they have custom layouts)
  const excludedPaths = ['/login', '/home', '/']
  if (excludedPaths.includes(location.pathname)) {
    return null
  }

  // If we don't have any breadcrumb items, don't show
  if (breadcrumbItems.length === 0) {
    return null
  }

  return (
    <div className="sticky top-0 z-20 px-6 py-3 border-b border-border/50">
      <div className="flex items-center justify-between">
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbItems.map((item, index) => {
              const isLast = index === breadcrumbItems.length - 1

              return (
                <div key={item.path} className="contents">
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage className="flex items-center gap-1.5">
                        {item.icon}
                        <span>{item.name}</span>
                      </BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link to={item.path} className="flex items-center gap-1.5">
                          {item.icon}
                          <span>{item.name}</span>
                        </Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!isLast && <BreadcrumbSeparator />}
                </div>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
        <ConnectionStatusBadge />
      </div>
    </div>
  )
}
