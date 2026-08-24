import { Link, useLocation } from "react-router-dom"
import { GlobeIcon } from "@/components/common/icons"
import { BrandLogo } from "@/components/common/brand"
import { Home, Printer, History, HelpCircle, Settings as SettingsIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { ThemeToggle } from "@/components/common/theme-toggle"
import { ConnectionStatusBadge } from '@/components/common/ConnectionStatusBadge'

export function AppSidebar({ mode = 'rail' }: { mode?: 'rail' | 'drawer' }) {
  const location = useLocation()
  const pathname = location.pathname
  const { locale, setLocale } = useI18n()
  const rail = mode === 'rail'

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
    <div className={cn(
      "app-sidebar flex h-full w-full flex-col overflow-hidden bg-sidebar pb-3 text-sidebar-foreground",
      rail ? "px-2 pt-12" : "px-3 pt-2",
    )}>
      <div className={cn(
        "flex shrink-0",
        rail ? "flex-col items-center gap-1 pb-4 text-center" : "items-center px-2 pb-4 pt-8",
      )}>
        {rail ? (
          <>
            <img src="/logo-mark-white.png" alt="" className="size-9 shrink-0 object-contain" />
            <span className="text-xs font-semibold leading-4 text-white">Print@SoC</span>
            <span className="text-xs uppercase leading-4 text-sidebar-foreground/65">NUS SoC</span>
          </>
        ) : (
          <BrandLogo className="min-w-0 gap-2" iconClassName="size-8" subtitle="NUS SoC Utility" inverse />
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
              className={cn(
                "group relative flex items-center overflow-hidden rounded-md font-medium transition-colors",
                rail
                  ? "min-h-14 flex-col justify-center gap-1 px-1 py-2 text-center text-xs leading-4"
                  : "h-11 gap-3 px-3 text-sm",
                isActive
                  ? "bg-white/12 text-white"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/90 hover:text-white",
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <item.icon className={cn("shrink-0", rail ? "size-5" : "size-4")} />
              <span>{item.name}</span>
            </Link>
            )
          })
        })()}
      </nav>

      <div className="shrink-0 space-y-1 pt-2 text-sidebar-foreground">
        <div
          className={cn("flex h-9 items-center", rail ? "justify-center" : "px-3")}
          title={rail ? "Connection status" : undefined}
        >
          <ConnectionStatusBadge compact={rail} appearance="sidebar" />
        </div>
        <ThemeToggle collapsed={rail} />

        <button
          onClick={toggleLocale}
          title={rail ? (locale === "en" ? "中文" : "English") : undefined}
          aria-label={locale === "en" ? "Switch language to Chinese" : "Switch language to English"}
          className={cn(
            "flex h-9 w-full items-center rounded-md text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-white",
            rail ? "justify-center" : "gap-2.5 px-3",
          )}
        >
          <GlobeIcon className="size-4 shrink-0" />
          {!rail && <span className="text-sm font-medium">{locale === "en" ? "中文" : "English"}</span>}
        </button>
      </div>
    </div>
  )
}
