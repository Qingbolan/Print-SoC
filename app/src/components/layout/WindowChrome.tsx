import { useEffect, useRef, type PointerEvent } from 'react'
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window'
import { WindowResizeController, type ResizeEdge } from '@/lib/window-resize'

const edges: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

export function WindowChrome() {
  const controller = useRef<WindowResizeController | null>(null)
  useEffect(() => () => { controller.current?.dispose(); controller.current = null }, [])
  if (document.documentElement.dataset.nativeMaterial !== 'acrylic') return null

  const beginResize = (event: PointerEvent<HTMLDivElement>, edge: ResizeEdge) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (!controller.current) {
      const window = getCurrentWindow()
      controller.current = new WindowResizeController({
        async snapshot() {
          const [position, size, scale] = await Promise.all([window.outerPosition(), window.outerSize(), window.scaleFactor()])
          return { bounds: { x: position.x, y: position.y, width: size.width, height: size.height }, scale }
        },
        async apply(bounds) {
          await window.setSize(new PhysicalSize(bounds.width, bounds.height))
          await window.setPosition(new PhysicalPosition(bounds.x, bounds.y))
        },
      }, error => console.error('Window resize failed:', error))
    }
    void controller.current.begin(edge, event.screenX, event.screenY, event.pointerId)
  }

  return <>
    <div className="app-titlebar" aria-hidden="true"
      onMouseDown={event => {
        if (event.button !== 0 || event.detail !== 1) return
        event.preventDefault()
        void getCurrentWindow().startDragging().catch(console.error)
      }}
      onDoubleClick={() => { void getCurrentWindow().toggleMaximize().catch(console.error) }}
    />
    {edges.map(edge => <div key={edge} className="window-resize-handle" data-edge={edge} aria-hidden="true"
      onPointerDown={event => beginResize(event, edge)}
      onPointerMove={event => controller.current?.move(event.screenX, event.screenY, event.pointerId)}
      onPointerUp={event => {
        controller.current?.move(event.screenX, event.screenY, event.pointerId)
        controller.current?.end(event.pointerId)
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onLostPointerCapture={event => controller.current?.end(event.pointerId)}
    />)}
  </>
}
