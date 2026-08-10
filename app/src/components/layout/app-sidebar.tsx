import { Link, useLocation } from "react-router-dom"
import { GlobeIcon } from "@/components/common/icons"
import { BrandLogo } from "@/components/common/brand"
import { Home, Printer, History, HelpCircle, Settings as SettingsIcon, PanelLeftIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { ThemeToggle } from "@/components/common/theme-toggle"
import { ConnectionStatusBadge } from '@/components/common/ConnectionStatusBadge'
import { useRBSidebar } from "@/components/reactbits/sidebar"

export function AppSidebar() {
  const location = useLocation()
  const pathname = location.pathname
  const { locale, setLocale } = useI18n()
  const { collapsed, toggle } = useRBSidebar()

  // Static navigation items - always show all items to prevent layout shift
  const navigation = [
    {
      name: "Home",
      href: "/home",
      icon: Home,
    },
    {
      name: "Printer",
      href: "/printer",
      icon: Printer,
    },
    {
      name: "Jobs",
      href: "/jobs",
      icon: History,
    },
    {
      name: "Help",
      href: "/help",
      icon: HelpCircle,
    },
    {
      name: "Settings",
      href: "/settings",
      icon: SettingsIcon,
    },
  ]

  const toggleLocale = () => {
    setLocale(locale === "en" ? "zh" : "en")
  }

  return (
    <div className="app-sidebar flex h-full w-full flex-col overflow-hidden bg-sidebar px-3 pb-3 pt-2 text-sidebar-foreground">
      <div
        className={cn(
          "flex shrink-0 items-center justify-between transition-[padding]",
          collapsed
            ? "cursor-pointer px-1 py-4 hover:bg-sidebar-accent/50"
            : "px-2 pb-4 pt-8"
        )}
        onClick={collapsed ? toggle : undefined}
      >
        <div className={cn(
          "flex items-center gap-3 flex-1 min-w-0",
          collapsed && "justify-center"
        )}>
          {collapsed ? (
            <img src="/logo-mark-white.png" alt="Print@SoC" className="size-10 shrink-0 object-contain" />
          ) : (
            <BrandLogo className="min-w-0 gap-2" iconClassName="size-8" subtitle="NUS SoC Utility" inverse />
          )}
        </div>
        {!collapsed && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggle()
            }}
            className="rounded-md p-2 text-slate-300 transition-colors hover:bg-sidebar-accent hover:text-white"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto overscroll-y-contain">
        {(() => {
          // Check if any navigation item matches the current path
          const hasActiveItem = navigation.some(item =>
            pathname === item.href ||
            (item.href === "/home" && pathname.startsWith("/preview"))
          )

          return navigation.map((item) => {
            // If no item matches, default to Home being active
            const isActive = pathname === item.href ||
              (item.href === "/home" && pathname.startsWith("/preview")) ||
              (item.href === "/home" && !hasActiveItem)
            return (
            <Link
              key={item.name}
              to={item.href}
              title={collapsed ? item.name : undefined}
              className={cn(
                "group relative flex h-11 items-center overflow-hidden rounded-md text-sm font-medium transition-colors md:h-10",
                collapsed ? "justify-center px-2" : "gap-3 px-3",
                isActive
                  ? "bg-white/12 text-white"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/90 hover:text-white",
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <item.icon className="size-4 shrink-0" />
              {!collapsed && (
                <span className="font-medium">{item.name}</span>
              )}
            </Link>
            )
          })
        })()}
      </nav>

      <div className="shrink-0 space-y-1 rounded-md bg-black/10 p-1.5 text-sidebar-foreground">
        <div className={cn('flex h-9 items-center px-2', collapsed ? 'justify-center' : 'justify-start')}>
          <ConnectionStatusBadge compact={collapsed} />
        </div>
        <div>
            <ThemeToggle collapsed={collapsed} />
        </div>

        <div>
          <button
            onClick={toggleLocale}
            title={collapsed ? (locale === "en" ? "中文" : "English") : undefined}
            className={cn(
              "flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-white",
              collapsed ? "justify-center" : "justify-start"
            )}
          >
            <GlobeIcon className="h-4 w-4 flex-shrink-0" />
            {!collapsed && (
              <span className="font-medium text-sm">{locale === "en" ? "中文" : "English"}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
