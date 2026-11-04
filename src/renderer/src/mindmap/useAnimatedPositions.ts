import { useCallback, useEffect, useRef, useState } from 'react'
import type { LayoutNode, Point } from './layout'

export type { Point }

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * Gleitet von den bisherigen zu den neuen Layout-Positionen. Neue Knoten wachsen aus
 * ihrem Elternknoten heraus. `place` setzt Knoten sofort an eine Stelle (z. B. dorthin,
 * wo sie gerade losgelassen wurden) – die nächste Animation startet dann von dort.
 */
export function useAnimatedPositions(
  target: Map<number, LayoutNode>,
  duration = 260
): { positions: Map<number, Point>; place(points: Map<number, Point>): void } {
  const [positions, setPositions] = useState<Map<number, Point>>(() => new Map(target))
  const current = useRef(positions)

  const place = useCallback((points: Map<number, Point>): void => {
    const next = new Map(current.current)
    for (const [id, p] of points) next.set(id, { x: p.x, y: p.y })
    current.current = next
    setPositions(next)
  }, [])

  useEffect(() => {
    const from = current.current
    const start = new Map<number, Point>()
    let moving = false
    for (const [id, node] of target) {
      const s = from.get(id) ?? (node.parentId != null ? from.get(node.parentId) : undefined) ?? node
      start.set(id, { x: s.x, y: s.y })
      if (Math.abs(s.x - node.x) > 0.5 || Math.abs(s.y - node.y) > 0.5) moving = true
    }

    const settle = (): void => {
      const done = new Map<number, Point>()
      for (const [id, n] of target) done.set(id, { x: n.x, y: n.y })
      current.current = done
      setPositions(done)
    }
    if (!moving || reducedMotion()) {
      settle()
      return
    }

    let frame = 0
    const t0 = performance.now()
    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / duration)
      if (t >= 1) {
        settle()
        return
      }
      const e = 1 - Math.pow(1 - t, 3)
      const next = new Map<number, Point>()
      for (const [id, n] of target) {
        const s = start.get(id)!
        next.set(id, { x: s.x + (n.x - s.x) * e, y: s.y + (n.y - s.y) * e })
      }
      current.current = next
      setPositions(next)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, duration])

  return { positions, place }
}
