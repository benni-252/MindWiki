import { hierarchy, tree } from 'd3-hierarchy'

// Reine Layout-Berechnung ohne React – deshalb auch in Node testbar.

export interface LayoutArticle {
  id: number
  parentId: number | null
  title: string
  position: number
  color: string | null
  collapsed: boolean
}

export type Side = 'root' | 'left' | 'right'

export interface LayoutNode {
  id: number
  parentId: number | null
  /** Rechte Seite: linke Kante des Knotens. Linke Seite: rechte Kante. Wurzel: Mitte. */
  x: number
  /** Vertikale Mitte des Knotens */
  y: number
  side: Side
  depth: number
  /** Astfarbe (geerbt vom Hauptast), leer für die Wurzel */
  color: string
  childCount: number
  /** Anzahl ausgeblendeter Nachfahren bei eingeklapptem Knoten */
  hiddenCount: number
}

export const BRANCH_COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599', '#e03131', '#5f3dc4']

export const ROW_HEIGHT = 46
export const H_GAP = 64

export type WidthFn = (article: LayoutArticle, depth: number) => number

/** Grobe Breitenschätzung passend zu den Schriftgrößen in styles.css. */
export const estimateWidth: WidthFn = (article, depth) => {
  const charWidth = depth === 0 ? 10.5 : depth === 1 ? 8.4 : 7.6
  const padding = depth === 0 ? 48 : 36
  const max = depth === 0 ? 300 : 240
  return Math.min(max, Math.max(64, article.title.length * charWidth + padding))
}

interface TreeItem {
  article: LayoutArticle
  children?: TreeItem[]
}

/**
 * Ordnet den Baum als Mind Map an: Wurzel in der Mitte, Hauptäste nach Blattanzahl auf
 * rechts/links verteilt (im Uhrzeigersinn), je Seite ein horizontaler Baum.
 */
export function layoutMindMap(
  articles: LayoutArticle[],
  rootId: number,
  widthOf: WidthFn = estimateWidth
): Map<number, LayoutNode> {
  const result = new Map<number, LayoutNode>()
  const byId = new Map(articles.map((a) => [a.id, a]))
  const root = byId.get(rootId)
  if (!root) return result

  const children = new Map<number, LayoutArticle[]>()
  for (const a of articles) {
    if (a.parentId == null || !byId.has(a.parentId)) continue
    const list = children.get(a.parentId) ?? []
    list.push(a)
    children.set(a.parentId, list)
  }
  for (const list of children.values()) list.sort((a, b) => a.position - b.position || a.id - b.id)

  const countDescendants = (id: number): number =>
    (children.get(id) ?? []).reduce((n, c) => n + 1 + countDescendants(c.id), 0)
  const build = (a: LayoutArticle): TreeItem => ({
    article: a,
    children: a.collapsed ? undefined : (children.get(a.id) ?? []).map(build)
  })
  const leaves = (t: TreeItem): number =>
    t.children?.length ? t.children.reduce((n, c) => n + leaves(c), 0) : 1

  const top = root.collapsed ? [] : (children.get(rootId) ?? []).map(build)

  // Farben: Hauptäste aus der Palette (oder eigene Farbe), darunter geerbt.
  const colorOf = new Map<number, string>()
  const paint = (t: TreeItem, inherited: string): void => {
    const color = t.article.color ?? inherited
    colorOf.set(t.article.id, color)
    t.children?.forEach((c) => paint(c, color))
  }
  top.forEach((t, i) => paint(t, BRANCH_COLORS[i % BRANCH_COLORS.length]))

  // Aufteilung: die ersten k Hauptäste rechts, so dass die Blattanzahl möglichst ausgeglichen ist.
  const weights = top.map(leaves)
  const total = weights.reduce((a, b) => a + b, 0)
  let split = top.length
  let bestDiff = Infinity
  let acc = 0
  for (let k = 1; k <= top.length; k++) {
    acc += weights[k - 1]
    const diff = Math.abs(acc - (total - acc))
    if (diff < bestDiff) {
      bestDiff = diff
      split = k
    }
  }
  const right = top.slice(0, split)
  const left = top.slice(split).reverse() // im Uhrzeigersinn: links von unten nach oben

  const rootWidth = widthOf(root, 0)
  result.set(root.id, {
    id: root.id,
    parentId: null,
    x: 0,
    y: 0,
    side: 'root',
    depth: 0,
    color: '',
    childCount: children.get(root.id)?.length ?? 0,
    hiddenCount: root.collapsed ? countDescendants(root.id) : 0
  })

  const layoutSide = (items: TreeItem[], side: 'left' | 'right'): void => {
    if (items.length === 0) return
    const h = hierarchy<TreeItem>({ article: root, children: items }, (d) => d.children)
    const positioned = tree<TreeItem>()
      .nodeSize([ROW_HEIGHT, 1])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.35))(h)

    const maxWidth: number[] = []
    for (const n of positioned.descendants()) {
      if (n.depth === 0) continue
      maxWidth[n.depth] = Math.max(maxWidth[n.depth] ?? 0, widthOf(n.data.article, n.depth))
    }
    const offset: number[] = [0, rootWidth / 2 + H_GAP]
    for (let d = 2; d < maxWidth.length; d++) offset[d] = offset[d - 1] + maxWidth[d - 1] + H_GAP

    const sign = side === 'right' ? 1 : -1
    for (const n of positioned.descendants()) {
      if (n.depth === 0) continue
      const a = n.data.article
      result.set(a.id, {
        id: a.id,
        parentId: a.parentId,
        x: sign * offset[n.depth],
        y: n.x,
        side,
        depth: n.depth,
        color: colorOf.get(a.id) ?? BRANCH_COLORS[0],
        childCount: children.get(a.id)?.length ?? 0,
        hiddenCount: a.collapsed ? countDescendants(a.id) : 0
      })
    }
  }
  layoutSide(right, 'right')
  layoutSide(left, 'left')
  return result
}

export interface Point {
  x: number
  y: number
}

/**
 * Frei gezogene Artikel: Jeder Knoten wandert um seinen eigenen Versatz und den aller Vorfahren –
 * so bleibt ein verschobener Ast beisammen, und neue Unterartikel landen ordentlich daneben.
 */
export function applyOffsets(layout: Map<number, LayoutNode>, offsets: Map<number, Point>): Map<number, LayoutNode> {
  if (offsets.size === 0) return layout
  const total = new Map<number, Point>()
  const shiftOf = (id: number): Point => {
    const known = total.get(id)
    if (known) return known
    const node = layout.get(id)
    const own = offsets.get(id) ?? { x: 0, y: 0 }
    const parent = node?.parentId != null && layout.has(node.parentId) ? shiftOf(node.parentId) : { x: 0, y: 0 }
    const sum = { x: own.x + parent.x, y: own.y + parent.y }
    total.set(id, sum)
    return sum
  }
  const result = new Map<number, LayoutNode>()
  for (const [id, node] of layout) {
    const s = shiftOf(id)
    result.set(id, s.x === 0 && s.y === 0 ? node : { ...node, x: node.x + s.x, y: node.y + s.y })
  }
  return result
}

/** Alle sichtbaren Nachfahren eines Knotens (ohne ihn selbst). */
export function descendantsOf(layout: Map<number, LayoutNode>, id: number): Set<number> {
  const children = new Map<number, number[]>()
  for (const node of layout.values()) {
    if (node.parentId == null) continue
    const list = children.get(node.parentId) ?? []
    list.push(node.id)
    children.set(node.parentId, list)
  }
  const found = new Set<number>()
  const stack = [...(children.get(id) ?? [])]
  while (stack.length > 0) {
    const next = stack.pop()!
    if (found.has(next)) continue
    found.add(next)
    stack.push(...(children.get(next) ?? []))
  }
  return found
}
