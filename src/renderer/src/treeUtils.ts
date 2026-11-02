import { computeImpact, type Impact } from '../../shared/impact'
import type { ArticleSummary, TreeData } from '../../shared/types'

export interface TreeIndex {
  byId: Map<number, ArticleSummary>
  children: Map<number, ArticleSummary[]>
}

const cache = new WeakMap<TreeData, TreeIndex>()

/** Nachschlage-Tabellen zum Baum, pro Baum-Objekt nur einmal berechnet. */
export function indexTree(tree: TreeData): TreeIndex {
  const hit = cache.get(tree)
  if (hit) return hit
  const byId = new Map(tree.articles.map((a) => [a.id, a]))
  const children = new Map<number, ArticleSummary[]>()
  for (const a of tree.articles) {
    if (a.parentId == null) continue
    const list = children.get(a.parentId) ?? []
    list.push(a)
    children.set(a.parentId, list)
  }
  for (const list of children.values()) list.sort((a, b) => a.position - b.position || a.id - b.id)
  const index = { byId, children }
  cache.set(tree, index)
  return index
}

/** Pfad von der Wurzel bis einschließlich `id`. */
export function pathTo(tree: TreeData, id: number): ArticleSummary[] {
  const { byId } = indexTree(tree)
  const path: ArticleSummary[] = []
  let current = byId.get(id)
  while (current && path.length < 1000) {
    path.unshift(current)
    current = current.parentId == null ? undefined : byId.get(current.parentId)
  }
  return path
}

export function isInSubtree(tree: TreeData, candidate: number, ancestor: number): boolean {
  return pathTo(tree, candidate).some((a) => a.id === ancestor)
}

export function countSubtree(tree: TreeData, id: number): number {
  const { children } = indexTree(tree)
  return 1 + (children.get(id) ?? []).reduce((n, c) => n + countSubtree(tree, c.id), 0)
}

const impactCache = new WeakMap<TreeData, Impact>()

/** Störungen und betroffene Artikel, pro Baum-Objekt nur einmal berechnet. */
export function impactOf(tree: TreeData): Impact {
  const hit = impactCache.get(tree)
  if (hit) return hit
  const outages = tree.articles.filter((a) => a.outageSince != null).map((a) => a.id)
  const impact = computeImpact(outages, tree.dependencies)
  impactCache.set(tree, impact)
  return impact
}

/** Sortiert Artikel-IDs nach Titel (für Listen in der Oberfläche). */
export function byTitle(tree: TreeData, ids: Iterable<number>): ArticleSummary[] {
  const { byId } = indexTree(tree)
  return [...ids]
    .map((id) => byId.get(id))
    .filter((a): a is ArticleSummary => !!a)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'))
}

/** Pro Wiki-Datei und Rechner: wann welcher Artikel zuletzt angesehen wurde. */
export interface SeenState {
  /** Änderungen vor diesem Zeitpunkt gelten als gesehen (erster Start mit dieser Datei) */
  baseline: string
  items: Record<string, string>
}

export function seenAt(seen: SeenState, id: number): string {
  return seen.items[id] ?? seen.baseline
}

/** Hat jemand anderes den Artikel geändert, seit ich ihn zuletzt angesehen habe? */
export function isUnseen(article: ArticleSummary, seen: SeenState | null): boolean {
  return !!seen && article.lastOtherChangeAt != null && article.lastOtherChangeAt > seenAt(seen, article.id)
}

export function unseenArticles(tree: TreeData, seen: SeenState | null): ArticleSummary[] {
  return tree.articles.filter((a) => isUnseen(a, seen))
}

/** „heute, 10:14“, „gestern, 09:02“ oder „28.10.2026, 16:40“ */
export function formatWhen(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  const day = (x: Date): string => x.toDateString()
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (day(d) === day(today)) return `heute, ${time}`
  if (day(d) === day(yesterday)) return `gestern, ${time}`
  return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}, ${time}`
}

/** Gehört der Name einem gelöschten Benutzer? */
export function isDeletedUser(tree: TreeData | null, name: string | null | undefined): boolean {
  if (!tree || !name) return false
  const lower = name.toLowerCase()
  return tree.deletedUsers.some((u) => u.toLowerCase() === lower)
}
