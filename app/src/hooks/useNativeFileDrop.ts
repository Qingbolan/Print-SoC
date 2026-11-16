import { useEffect, useRef, useState } from 'react'
import { isTauriAvailable } from '@/lib/tauri-utils'

/** Owns one native subscription, including registration that finishes after unmount. */
export function useNativeFileDrop(onDrop: (paths: string[]) => void) {
  const [isDragging, setIsDragging] = useState(false)
  const handler = useRef(onDrop)
  useEffect(() => { handler.current = onDrop }, [onDrop])

  useEffect(() => {
    if (!isTauriAvailable()) return
    let disposed = false
    let unlisten: (() => void) | undefined

    async function subscribe() {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
        if (disposed) return
        const release = await getCurrentWebviewWindow().onDragDropEvent(({ payload }) => {
          if (disposed) return
          switch (payload.type) {
            case 'enter':
            case 'over':
              setIsDragging(true)
              break
            case 'leave':
              setIsDragging(false)
              break
            case 'drop':
              setIsDragging(false)
              handler.current(payload.paths)
              break
          }
        })
        if (disposed) release()
        else unlisten = release
      } catch (error) {
        console.error('Failed to register native file drop:', error)
      }
    }

    void subscribe()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  return isDragging
}
