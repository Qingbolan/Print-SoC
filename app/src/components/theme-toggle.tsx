
import * as React from "react"
import { useTheme } from "@/lib/theme-context"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Simple icon components
function SunIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  )
}

function MoonIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

function MonitorIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  )
}

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Button variant="outline" size="sm" className="w-full justify-start gap-2">
        <MonitorIcon className="h-4 w-4" />
        {!collapsed && <span>Theme</span>}
      </Button>
    )
  }

  // If collapsed, only show a toggle button
  if (collapsed) {
    const toggleTheme = () => {
      setTheme(theme === "light" ? "dark" : "light")
    }

    return (
      <button
        onClick={toggleTheme}
        title={theme === "light" ? "Switch to Dark" : "Switch to Light"}
        className={cn(
          "w-full flex items-center justify-center px-2 py-2 rounded-lg text-sm transition-all duration-167 fluent-transition",
          "bg-primary/10 text-primary border border-primary/20"
        )}
      >
        {theme === "light" ? (
          <SunIcon className="h-4 w-4" />
        ) : (
          <MoonIcon className="h-4 w-4" />
        )}
      </button>
    )
  }

  // Expanded state shows two buttons
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          onClick={() => setTheme("light")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-167 fluent-transition",
            theme === "light"
              ? "bg-primary/10 text-primary border border-primary/20"
              : "bg-muted hover:bg-muted-hover text-muted-foreground"
          )}
        >
          <SunIcon className="h-4 w-4 flex-shrink-0" />
          <span>Light</span>
        </button>

        <button
          onClick={() => setTheme("dark")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-167 fluent-transition",
            theme === "dark"
              ? "bg-primary/10 text-primary border border-primary/20"
              : "bg-muted hover:bg-muted-hover text-muted-foreground"
          )}
        >
          <MoonIcon className="h-4 w-4 flex-shrink-0" />
          <span>Dark</span>
        </button>
{/* 
        <button
          onClick={() => setTheme("system")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm",
            "transition-all duration-167 fluent-transition",
            theme === "system"
              ? "bg-primary/10 text-primary border border-primary/20"
              : "bg-muted hover:bg-muted-hover text-muted-foreground"
          )}
        >
          <MonitorIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Auto</span>
        </button> */}
      </div>
    </div>
  )
}
