
import * as React from "react"
import { useTheme } from "@/lib/theme-context"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Monitor, Moon, Sun } from "lucide-react"

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const { theme, setTheme, resolvedTheme } = useTheme()
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
      setTheme(resolvedTheme === "light" ? "dark" : "light")
    }

    return (
      <button
        onClick={toggleTheme}
        title={resolvedTheme === "light" ? "Switch to Dark" : "Switch to Light"}
        className={cn(
          "flex h-9 w-full items-center justify-center rounded-md text-sidebar-foreground/80 transition-colors duration-167",
          "hover:bg-sidebar-accent hover:text-white"
        )}
      >
        {resolvedTheme === "light" ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
      </button>
    )
  }

  const options = [
    { value: "light" as const, label: "Light", icon: Sun },
    { value: "dark" as const, label: "Dark", icon: Moon },
    { value: "system" as const, label: "Auto", icon: Monitor },
  ]

  return (
    <div
      className="grid grid-cols-3 gap-1 rounded-md bg-black/10 p-1"
      role="group"
      aria-label="Theme"
    >
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          aria-pressed={theme === value}
          className={cn(
            "flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-1 text-xs transition-colors duration-167",
            theme === value
              ? "bg-white/12 text-white"
              : "text-sidebar-foreground/65 hover:bg-sidebar-accent/80 hover:text-white"
          )}
        >
          <Icon className="size-3.5 shrink-0" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
