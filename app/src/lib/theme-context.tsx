
import * as React from "react"

type Theme = "light" | "dark" | "system"

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  resolvedTheme: "light" | "dark"
}

const ThemeContext = React.createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>("system")
  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark">("light")
  const isTransitioningRef = React.useRef(false)

  React.useEffect(() => {
    // Read theme setting from localStorage
    const stored = localStorage.getItem("theme") as Theme
    if (stored && ["light", "dark", "system"].includes(stored)) {
      setThemeState(stored)
    }
  }, [])

  React.useEffect(() => {
    const root = document.documentElement

    let effectiveTheme: "light" | "dark" = "light"

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      effectiveTheme = systemTheme
    } else {
      effectiveTheme = theme
    }

    // Use View Transition API for smooth switching (if browser supports it)
    const supportsViewTransitions = 'startViewTransition' in document
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const isDocumentVisible = document.visibilityState === 'visible'

    const applyTheme = () => {
      root.classList.remove("light", "dark")
      root.classList.add(effectiveTheme)
      setResolvedTheme(effectiveTheme)
    }

    if (supportsViewTransitions && !prefersReducedMotion && isDocumentVisible) {
      // Skip if a transition is already in progress
      if (isTransitioningRef.current) {
        // Just apply theme directly if already transitioning
        applyTheme()
        return
      }

      isTransitioningRef.current = true

      // @ts-ignore - View Transition API types not fully supported yet
      const transition = document.startViewTransition(() => {
        applyTheme()
      })

      transition.finished
        .then(() => {
          isTransitioningRef.current = false
        })
        .catch((e: any) => {
          // Silently handle AbortError and InvalidStateError
          isTransitioningRef.current = false
          if (e.name !== 'AbortError' && e.name !== 'InvalidStateError') {
            console.error('View transition error:', e)
          }
        })
    } else {
      // Fallback solution
      applyTheme()
    }

    // Set color-scheme property for better performance
    root.style.colorScheme = effectiveTheme

    // Save to localStorage
    localStorage.setItem("theme", theme)
  }, [theme])

  // Listen for system theme changes
  React.useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")

    const handleChange = () => {
      if (theme === "system") {
        const systemTheme = mediaQuery.matches ? "dark" : "light"
        setResolvedTheme(systemTheme)
        document.documentElement.classList.remove("light", "dark")
        document.documentElement.classList.add(systemTheme)
      }
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [theme])

  const setTheme = React.useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = React.useContext(ThemeContext)
  if (!context) {
    // In development, log warning but return default values to handle hot reload
    if (process.env.NODE_ENV === 'development') {
      console.warn("useTheme: ThemeProvider not found, using default theme")
      return {
        theme: "system" as Theme,
        setTheme: () => {},
        resolvedTheme: "light" as "light" | "dark"
      }
    }
    throw new Error("useTheme must be used within ThemeProvider")
  }
  return context
}
