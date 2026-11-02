import type { DependencyEdge } from './types'

// Auswirkungen von Störungen über die Abhängigkeiten – ohne React, deshalb in Node testbar.

export interface AffectedEntry {
  /** Gestörte Artikel, von denen dieser Artikel direkt oder indirekt abhängt */
  causes: number[]
  /** Kürzester Abstand zu einer Störung: 1 = hängt direkt von einem gestörten Artikel ab */
  distance: number
  /** Nächster Schritt auf dem kürzesten Weg zur Störung (eine Abhängigkeit dieses Artikels) */
  via: number
}

export interface Impact {
  /** Artikel mit gemeldeter Störung */
  outages: Set<number>
  /** Artikel ohne eigene Störung, die von einer Störung betroffen sind */
  affected: Map<number, AffectedEntry>
  /** Je Störung die betroffenen Artikel samt Abstand, nach Abstand sortiert (ohne andere gestörte Artikel) */
  byOutage: Map<number, { id: number; distance: number }[]>
}

/**
 * Ermittelt, welche Artikel von den Störungen betroffen sind: alle, die direkt oder über
 * mehrere Stufen von einem gestörten Artikel abhängen. Kreise in den Abhängigkeiten sind erlaubt.
 */
export function computeImpact(outageIds: Iterable<number>, dependencies: DependencyEdge[]): Impact {
  const outages = new Set(outageIds)
  const dependents = new Map<number, number[]>()
  for (const d of dependencies) {
    const list = dependents.get(d.dependsOnId) ?? []
    list.push(d.articleId)
    dependents.set(d.dependsOnId, list)
  }

  const affected = new Map<number, AffectedEntry>()
  const byOutage: Impact['byOutage'] = new Map()
  for (const outage of outages) {
    const hit: { id: number; distance: number }[] = []
    const seen = new Set([outage])
    let frontier = [outage]
    for (let distance = 1; frontier.length > 0; distance++) {
      const next: number[] = []
      for (const from of frontier) {
        for (const id of dependents.get(from) ?? []) {
          if (seen.has(id)) continue
          seen.add(id)
          next.push(id)
          if (outages.has(id)) continue
          hit.push({ id, distance })
          const entry = affected.get(id)
          if (!entry) affected.set(id, { causes: [outage], distance, via: from })
          else {
            entry.causes.push(outage)
            if (distance < entry.distance) Object.assign(entry, { distance, via: from })
          }
        }
      }
      frontier = next
    }
    byOutage.set(outage, hit)
  }
  return { outages, affected, byOutage }
}

/** Weg von einer Störung bis zu `id`, z. B. [SQL-Server, App-Server, Warenwirtschaft]. */
export function impactChain(impact: Impact, id: number): number[] {
  const chain = [id]
  let current = impact.affected.get(id)
  while (current && chain.length < 1000) {
    chain.unshift(current.via)
    current = impact.affected.get(current.via)
  }
  return chain
}

export type ImpactStatus = 'outage' | 'affected' | null

export function impactStatus(impact: Impact, id: number): ImpactStatus {
  if (impact.outages.has(id)) return 'outage'
  return impact.affected.has(id) ? 'affected' : null
}
