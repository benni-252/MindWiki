import { describe, expect, it } from 'vitest'
import { BRANCH_COLORS, layoutMindMap, ROW_HEIGHT, type LayoutArticle } from '../src/renderer/src/mindmap/layout'

let nextId = 1
const art = (parentId: number | null, title = `A${nextId}`, extra: Partial<LayoutArticle> = {}): LayoutArticle => ({
  id: nextId++,
  parentId,
  title,
  position: nextId,
  color: null,
  collapsed: false,
  ...extra
})

describe('Mind-Map-Layout', () => {
  it('setzt die Wurzel in die Mitte und verteilt Hauptäste auf beide Seiten', () => {
    const root = art(null, 'Wiki')
    const items = [root, art(root.id), art(root.id), art(root.id), art(root.id)]
    const layout = layoutMindMap(items, root.id)
    expect(layout.get(root.id)).toMatchObject({ x: 0, y: 0, side: 'root' })
    const sides = items.slice(1).map((a) => layout.get(a.id)!.side)
    expect(sides).toEqual(['right', 'right', 'left', 'left'])
    for (const a of items.slice(1)) {
      const n = layout.get(a.id)!
      expect(Math.sign(n.x)).toBe(n.side === 'right' ? 1 : -1)
    }
  })

  it('gleicht nach Blattanzahl aus, nicht nach Anzahl der Hauptäste', () => {
    const root = art(null)
    const big = art(root.id)
    const kids = [art(big.id), art(big.id), art(big.id), art(big.id)]
    const small = [art(root.id), art(root.id), art(root.id)]
    const layout = layoutMindMap([root, big, ...kids, ...small], root.id)
    expect(layout.get(big.id)!.side).toBe('right')
    expect(small.map((a) => layout.get(a.id)!.side)).toEqual(['left', 'left', 'left'])
  })

  it('blendet eingeklappte Äste aus und zählt die versteckten Artikel', () => {
    const root = art(null)
    const branch = art(root.id, 'Ast', { collapsed: true })
    const child = art(branch.id)
    const grandchild = art(child.id)
    const layout = layoutMindMap([root, branch, child, grandchild], root.id)
    expect(layout.has(child.id)).toBe(false)
    expect(layout.has(grandchild.id)).toBe(false)
    expect(layout.get(branch.id)).toMatchObject({ hiddenCount: 2, childCount: 1 })
  })

  it('vererbt Astfarben und respektiert eigene Farben', () => {
    const root = art(null)
    const a = art(root.id)
    const a1 = art(a.id)
    const b = art(root.id, 'B', { color: '#123456' })
    const b1 = art(b.id)
    const layout = layoutMindMap([root, a, a1, b, b1], root.id)
    expect(layout.get(a1.id)!.color).toBe(BRANCH_COLORS[0])
    expect(layout.get(b1.id)!.color).toBe('#123456')
  })

  it('lässt Knoten derselben Spalte nicht überlappen', () => {
    const root = art(null)
    const items: LayoutArticle[] = [root]
    for (let i = 0; i < 4; i++) {
      const top = art(root.id)
      items.push(top)
      for (let j = 0; j < 3; j++) {
        const mid = art(top.id)
        items.push(mid, art(mid.id), art(mid.id))
      }
    }
    const nodes = [...layoutMindMap(items, root.id).values()]
    for (const a of nodes) {
      for (const b of nodes) {
        if (a === b || a.side !== b.side || a.depth !== b.depth || a.side === 'root') continue
        expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(ROW_HEIGHT - 0.001)
      }
    }
  })

  it('rückt tiefere Ebenen weiter nach außen', () => {
    const root = art(null)
    const a = art(root.id)
    const a1 = art(a.id)
    const layout = layoutMindMap([root, a, a1], root.id)
    expect(layout.get(a1.id)!.x).toBeGreaterThan(layout.get(a.id)!.x)
  })
})
