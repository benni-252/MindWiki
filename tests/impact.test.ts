import { describe, expect, it } from 'vitest'
import { computeImpact, impactChain, impactStatus } from '../src/shared/impact'
import type { DependencyEdge } from '../src/shared/types'

/** `dep(a, b)`: a hängt ab von b */
const dep = (articleId: number, dependsOnId: number): DependencyEdge => ({ articleId, dependsOnId })

describe('Auswirkungen von Störungen', () => {
  // 1 Switch ← 2 SQL-Server ← 3 App-Server ← 4 Warenwirtschaft, 5 Drucker hängt nur am Switch, 6 unbeteiligt
  const deps = [dep(2, 1), dep(3, 2), dep(4, 3), dep(5, 1), dep(7, 6)]

  it('findet direkt und indirekt betroffene Artikel', () => {
    const impact = computeImpact([2], deps)
    expect([...impact.affected.keys()].sort()).toEqual([3, 4])
    expect(impact.affected.get(3)).toEqual({ causes: [2], distance: 1, via: 2 })
    expect(impact.affected.get(4)).toEqual({ causes: [2], distance: 2, via: 3 })
    expect(impact.byOutage.get(2)).toEqual([
      { id: 3, distance: 1 },
      { id: 4, distance: 2 }
    ])
    expect(impactChain(impact, 4)).toEqual([2, 3, 4])
    expect(impactStatus(impact, 2)).toBe('outage')
    expect(impactStatus(impact, 4)).toBe('affected')
    expect(impactStatus(impact, 1)).toBeNull()
  })

  it('zählt gestörte Artikel nicht als betroffen, folgt ihnen aber weiter', () => {
    const impact = computeImpact([1, 3], deps)
    expect([...impact.affected.keys()].sort()).toEqual([2, 4, 5])
    expect(impact.byOutage.get(1)?.map((e) => [e.id, e.distance])).toEqual([
      [2, 1],
      [5, 1],
      [4, 3]
    ])
    expect(impact.byOutage.get(3)).toEqual([{ id: 4, distance: 1 }])
    // Warenwirtschaft hängt am nächsten an der Störung des App-Servers
    expect(impact.affected.get(4)).toEqual({ causes: [1, 3], distance: 1, via: 3 })
    expect(impactChain(impact, 4)).toEqual([3, 4])
  })

  it('kommt mit Kreisen und mehreren Wegen zurecht', () => {
    // 10 ↔ 11 hängen voneinander ab, 12 hängt an beiden
    const impact = computeImpact([10], [dep(10, 11), dep(11, 10), dep(12, 10), dep(12, 11)])
    expect([...impact.affected.keys()].sort()).toEqual([11, 12])
    expect(impact.affected.get(12)).toMatchObject({ distance: 1, via: 10 })
    expect(impactChain(impact, 11)).toEqual([10, 11])
  })

  it('meldet nichts ohne Störung', () => {
    const impact = computeImpact([], deps)
    expect(impact.affected.size).toBe(0)
    expect(impact.byOutage.size).toBe(0)
  })
})
