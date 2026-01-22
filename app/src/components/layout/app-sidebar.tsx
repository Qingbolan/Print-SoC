import { useMemo } from "react"
import { Link, useLocation } from "react-router-dom"
import { GlobeIcon } from "@/components/common/icons"
import { Home, Printer, History, HelpCircle, Settings as SettingsIcon, PanelLeftIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { ThemeToggle } from "@/components/common/theme-toggle"
import { useRBSidebar } from "@/components/reactbits/sidebar"

export function AppSidebar() {
  const location = useLocation()
  const pathname = location.pathname
  const { locale, setLocale } = useI18n()
  const { collapsed, toggle } = useRBSidebar()

  // Static navigation items - always show all items to prevent layout shift
  const navigation = useMemo(() => [
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
  ], [])

  const toggleLocale = () => {
    setLocale(locale === "en" ? "zh" : "en")
  }

  return (
    <div
      className="flex h-full w-full flex-col relative overflow-hidden mica"
    >
      {/* Noise texture overlay for Mica effect */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none z-0"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='3.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          backgroundSize: '150px 150px',
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex h-full w-full flex-col">
      {/* Logo Header with modern styling */}
      <div
        className={cn(
          "flex h-16 items-center justify-between transition-all backdrop-blur-sm",
          collapsed ? "px-3 cursor-pointer hover:bg-sidebar-accent/50" : "px-5"
        )}
        onClick={collapsed ? toggle : undefined}
      >
        <div className={cn(
          "flex items-center gap-3 flex-1 min-w-0",
          collapsed && "justify-center"
        )}>
          <div className="relative">
            <img
              src="/logo.png"
              alt="Print@SoC"
              className="h-10 w-10 flex-shrink-0"
            />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-base font-semibold whitespace-nowrap overflow-hidden bg-gradient-to-r from-[var(--theme-gradient-start)] to-[var(--theme-gradient-end)] bg-clip-text text-transparent">
                Print@SoC
              </span>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggle()
            }}
            className="p-2 rounded-lg hover:bg-sidebar-accent/70 transition-all duration-167 fluent-transition hover:fluent-shadow-xs"
            title="Collapse sidebar"
          >
            <PanelLeftIcon className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Navigation with modern styling */}
      <nav className="flex-1 p-3 pt-0 overflow-y-auto overscroll-y-contain">
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
                "group relative flex items-center py-3 text-sm font-medium overflow-hidden",
                collapsed ? "justify-center px-3 rounded-full" : "gap-3 px-4 rounded-xl",
                isActive
                  ? "bg-gradient-to-r from-[var(--theme-gradient-start)]/15 to-[var(--theme-gradient-end)]/10 text-[var(--theme-gradient-start)] border border-[var(--theme-gradient-start)]/20 fluent-shadow-sm"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/70 border border-transparent hover:border-sidebar-border/30",
              )}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              {!collapsed && (
                <span className="font-medium">{item.name}</span>
              )}
              {/* Hover effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-[var(--theme-gradient-start)]/5 to-[var(--theme-gradient-end)]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-167 pointer-events-none" />
            </Link>
            )
          })
        })()}
      </nav>

      {/* Bottom section with backdrop */}
      <div className="backdrop-blur-sm bg-sidebar/30">
        {/* Theme Toggle */}
        <div className="p-3">
            <ThemeToggle collapsed={collapsed} />
        </div>

        {/* Language Toggle */}
        <div className="p-3 pt-0">
          <button
            onClick={toggleLocale}
            title={collapsed ? (locale === "en" ? "中文" : "English") : undefined}
            className={cn(
              "w-full gap-2.5 transition-all px-3 py-2.5 rounded-xl border fluent-transition",
              "border-sidebar-border/50 hover:border-primary/30",
              "hover:bg-gradient-to-r hover:from-sidebar-accent/70 hover:to-sidebar-accent/50",
              "hover:fluent-shadow-xs",
              collapsed ? "justify-center px-3 flex items-center" : "justify-start flex items-center"
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
    </div>
  )
}
