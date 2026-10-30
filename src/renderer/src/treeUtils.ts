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
