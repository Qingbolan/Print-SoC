
import * as React from "react"
import { useTheme } from "@/lib/theme-context"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Monitor, Moon, Sun } from "lucide-react"

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Button variant="outline" size="sm" className="w-full justify-start gap-2">
        <Monitor className="h-4 w-4" />
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
          "flex w-full items-center justify-center rounded-md px-2 py-2 text-sm transition-colors duration-167",
          "bg-primary/10 text-primary"
        )}
      >
        {theme === "light" ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
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
          aria-pressed={theme === "light"}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors duration-167",
            theme === "light"
              ? "bg-card text-primary"
              : "text-muted-foreground hover:bg-sidebar-accent"
          )}
        >
          <Sun className="h-4 w-4 flex-shrink-0" />
          <span>Light</span>
        </button>

        <button
          onClick={() => setTheme("dark")}
          aria-pressed={theme === "dark"}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors duration-167",
            theme === "dark"
              ? "bg-card text-primary"
              : "text-muted-foreground hover:bg-sidebar-accent"
          )}
        >
          <Moon className="h-4 w-4 flex-shrink-0" />
          <span>Dark</span>
        </button>
{/*
        <button
          onClick={() => setTheme("system")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm",
            "transition-all duration-167 fluent-transition",
            theme === "system"
              ? "bg-primary/10 text-primary"
              : "bg-muted hover:bg-muted-hover text-muted-foreground"
          )}
        >
          <Monitor className="h-4 w-4" />
          <span className="hidden sm:inline">Auto</span>
        </button> */}
      </div>
    </div>
  )
}
