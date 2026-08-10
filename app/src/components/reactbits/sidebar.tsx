
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

type SidebarContextValue = {
  collapsed: boolean
  toggle: () => void
  setCollapsed: (v: boolean) => void
  expandedWidth: number
  collapsedWidth: number
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function useRBSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error("useRBSidebar must be used within RBSidebarProvider")
  return ctx
}

export function RBSidebarProvider({
  children,
  expandedWidth = 260,
  collapsedWidth = 64,
}: {
  children: React.ReactNode
  expandedWidth?: number
  collapsedWidth?: number
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    const compactViewport = window.innerWidth >= 768 && window.innerWidth < 1200
    try {
      const v = localStorage.getItem("rb_sidebar_collapsed")
      const initialCollapsed = compactViewport || v === "1"
      document.documentElement.style.setProperty(
        "--rb-sidebar-width",
        `${initialCollapsed ? collapsedWidth : expandedWidth}px`,
      )
      return initialCollapsed
    } catch {
      document.documentElement.style.setProperty(
        "--rb-sidebar-width",
        `${compactViewport ? collapsedWidth : expandedWidth}px`,
      )
      return compactViewport
    }
  })

  const applyWidthVar = useCallback(
    (isCollapsed: boolean) => {
      const w = isCollapsed ? collapsedWidth : expandedWidth
      if (typeof document !== "undefined") {
        document.documentElement.style.setProperty("--rb-sidebar-width", `${w}px`)
      }
    },
    [collapsedWidth, expandedWidth],
  )

  useEffect(() => {
    applyWidthVar(collapsed)
    try {
      localStorage.setItem("rb_sidebar_collapsed", collapsed ? "1" : "0")
    } catch {}
  }, [collapsed, applyWidthVar])

  useEffect(() => {
    // Ensure initial var is set on mount
    applyWidthVar(collapsed)
  }, [])

  useEffect(() => {
    const compactQuery = window.matchMedia('(min-width: 768px) and (max-width: 1199px)')
    const collapseForCompactViewport = () => {
      if (compactQuery.matches) setCollapsed(true)
    }

    collapseForCompactViewport()
    compactQuery.addEventListener('change', collapseForCompactViewport)
    return () => compactQuery.removeEventListener('change', collapseForCompactViewport)
  }, [])

  const toggle = useCallback(() => setCollapsed((v) => !v), [])

  const value = useMemo(
    () => ({ collapsed, toggle, setCollapsed, expandedWidth, collapsedWidth }),
    [collapsed, toggle, expandedWidth, collapsedWidth],
  )

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

export function RBSidebar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <aside
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        zIndex: 30,
        overflow: "hidden",
        backgroundColor: "var(--sidebar)",
      }}
    >
      {children}
    </aside>
  )
}
export function RBMainOffset({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={className}
      style={{
        marginLeft: "var(--rb-sidebar-width)",
        transition: "margin-left 200ms ease",
      }}
    >
      {children}
    </div>
  )
}
