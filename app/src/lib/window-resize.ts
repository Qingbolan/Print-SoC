export type WindowBounds = { x: number; y: number; width: number; height: number }
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** Physical-pixel geometry; keeps the opposite edge fixed at the minimum size. */
export function resizeWindowBounds(bounds: WindowBounds, edge: ResizeEdge, dx: number, dy: number, minimum: number): WindowBounds {
  const width = edge.includes('e') ? Math.max(minimum, bounds.width + dx)
    : edge.includes('w') ? Math.max(minimum, bounds.width - dx) : bounds.width
  const height = edge.includes('s') ? Math.max(minimum, bounds.height + dy)
    : edge.includes('n') ? Math.max(minimum, bounds.height - dy) : bounds.height
  return {
    x: edge.includes('w') ? bounds.x + bounds.width - width : bounds.x,
    y: edge.includes('n') ? bounds.y + bounds.height - height : bounds.y,
    width, height,
  }
}

export interface WindowGeometryPort {
  snapshot(): Promise<{ bounds: WindowBounds; scale: number }>
  apply(bounds: WindowBounds): Promise<void>
}

type Gesture = {
  phase: 'starting' | 'dragging' | 'released'
  pointer: number
  edge: ResizeEdge
  x: number
  y: number
  latestX: number
  latestY: number
  origin?: WindowBounds
  scale: number
}

/** One controller owns all gestures and native writes for a window. A new
 * gesture waits for the previous gesture's final geometry before taking origin. */
export class WindowResizeController {
  private gesture?: Gesture
  private pending?: WindowBounds
  private writing?: Promise<void>
  private disposed = false

  constructor(private readonly port: WindowGeometryPort, private readonly onError: (error: unknown) => void) {}

  async begin(edge: ResizeEdge, x: number, y: number, pointer: number): Promise<void> {
    if (this.disposed) return
    const gesture: Gesture = { phase: 'starting', pointer, edge, x, y, latestX: x, latestY: y, scale: 1 }
    this.gesture = gesture
    try {
      await this.writing
      if (this.gesture !== gesture || this.disposed) return
      const { bounds, scale } = await this.port.snapshot()
      if (this.gesture !== gesture || this.disposed) return
      gesture.origin = bounds
      gesture.scale = scale
      if (gesture.phase === 'starting') gesture.phase = 'dragging'
      this.enqueue(gesture)
    } catch (error) { this.fail(error) }
  }

  move(x: number, y: number, pointer: number) {
    const gesture = this.gesture
    if (!gesture || gesture.pointer !== pointer || gesture.phase === 'released' || this.disposed) return
    gesture.latestX = x
    gesture.latestY = y
    this.enqueue(gesture)
  }

  end(pointer: number) {
    if (this.gesture?.pointer === pointer) this.gesture.phase = 'released'
  }

  dispose() {
    this.disposed = true
    this.gesture = undefined
    this.pending = undefined
  }

  private enqueue(gesture: Gesture) {
    if (!gesture.origin || (gesture.latestX === gesture.x && gesture.latestY === gesture.y)) return
    this.pending = resizeWindowBounds(gesture.origin, gesture.edge,
      Math.round((gesture.latestX - gesture.x) * gesture.scale),
      Math.round((gesture.latestY - gesture.y) * gesture.scale), 480 * gesture.scale)
    void this.flush().catch(error => this.fail(error))
  }

  private flush(): Promise<void> {
    if (this.writing) return this.writing
    this.writing = (async () => {
      while (this.pending && !this.disposed) {
        const next = this.pending
        this.pending = undefined
        await this.port.apply(next)
      }
    })().finally(() => { this.writing = undefined })
    return this.writing
  }

  private fail(error: unknown) {
    this.pending = undefined
    this.gesture = undefined
    this.onError(error)
  }
}
