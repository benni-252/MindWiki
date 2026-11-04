import { beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, openDatabase } from '../src/main/db'
import { WikiError, WikiStore } from '../src/main/store'
import { applyOffsets, descendantsOf, layoutMindMap, type LayoutArticle } from '../src/renderer/src/mindmap/layout'

let store: WikiStore
let root: number

const summary = (id: number) => store.getTree().articles.find((a) => a.id === id)!

beforeEach(() => {
  store = new WikiStore(openDatabase(':memory:', 'Team'), 'Anna')
  root = store.rootId()
})

describe('Frei verschobene Artikel (Wiki-Datei)', () => {
  it('merkt sich den Versatz gerundet, ohne Verlauf, und 0/0 heißt wieder automatisch', () => {
    const a = store.createArticle(root, 'Server')
    const before = store.getChanges(a).length
    store.setArticleOffset(a, 120.4, -35.6)
    expect(summary(a)).toMatchObject({ offsetX: 120, offsetY: -36 })
    expect(store.getChanges(a)).toHaveLength(before)
    store.setArticleOffset(a, 0, 0)
    expect(summary(a)).toMatchObject({ offsetX: 0, offsetY: 0 })
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM article_layout').get()).toEqual({ n: 0 })
  })

  it('lässt die Wurzel in der Mitte und lehnt Unsinn ab', () => {
    expect(() => store.setArticleOffset(root, 10, 10)).toThrow(WikiError)
    const a = store.createArticle(root, 'A')
    expect(() => store.setArticleOffset(a, Number.NaN, 0)).toThrow(WikiError)
    store.setArticleOffset(a, 1e12, -1e12)
    expect(summary(a)).toMatchObject({ offsetX: 100_000, offsetY: -100_000 })
  })

  it('setzt einen Ast zurück und reiht umgehängte Artikel ordentlich ein', () => {
    const a = store.createArticle(root, 'A')
    const b = store.createArticle(a, 'B')
    const c = store.createArticle(root, 'C')
    store.setArticleOffset(a, 50, 50)
    store.setArticleOffset(b, 20, 0)
    store.setArticleOffset(c, -30, 10)
    expect(store.resetArticleLayout(a)).toBe(2)
    expect(summary(a).offsetX).toBe(0)
    expect(summary(b).offsetX).toBe(0)
    expect(summary(c).offsetX).toBe(-30)

    // Umhängen: eigener Versatz fällt weg, Unterartikel behalten ihren
    store.setArticleOffset(a, 50, 50)
    store.setArticleOffset(b, 20, 0)
    store.moveArticle(a, c)
    expect(summary(a)).toMatchObject({ offsetX: 0, offsetY: 0 })
    expect(summary(b)).toMatchObject({ offsetX: 20, offsetY: 0 })

    // Ganze Karte
    expect(store.resetArticleLayout(root)).toBe(2)
    // Endgültig gelöschte Artikel nehmen ihren Versatz mit
    store.setArticleOffset(b, 5, 5)
    store.deleteArticle(a)
    store.purgeArticle(a)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM article_layout').get()).toEqual({ n: 0 })
  })

  it('braucht keinen Versionssprung – ältere Versionen öffnen die Datei weiter', () => {
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length })
  })
})

describe('Anordnung in der Mind Map', () => {
  const art = (id: number, parentId: number | null): LayoutArticle => ({
    id,
    parentId,
    title: `A${id}`,
    position: id,
    color: null,
    collapsed: false
  })
  const articles = [art(1, null), art(2, 1), art(3, 2), art(4, 3), art(5, 1)]
  const layout = layoutMindMap(articles, 1, () => 100)

  it('verschiebt einen Artikel samt allen Unterartikeln', () => {
    const moved = applyOffsets(layout, new Map([[2, { x: 40, y: -20 }]]))
    for (const id of [2, 3, 4]) {
      expect(moved.get(id)!.x).toBe(layout.get(id)!.x + 40)
      expect(moved.get(id)!.y).toBe(layout.get(id)!.y - 20)
    }
    expect(moved.get(1)).toBe(layout.get(1))
    expect(moved.get(5)).toBe(layout.get(5))
  })

  it('addiert die Versätze entlang des Astes', () => {
    const moved = applyOffsets(
      layout,
      new Map([
        [2, { x: 40, y: 0 }],
        [3, { x: 0, y: 25 }]
      ])
    )
    expect(moved.get(4)!.x).toBe(layout.get(4)!.x + 40)
    expect(moved.get(4)!.y).toBe(layout.get(4)!.y + 25)
    expect(applyOffsets(layout, new Map())).toBe(layout)
  })

  it('findet alle sichtbaren Nachfahren', () => {
    expect([...descendantsOf(layout, 2)].sort()).toEqual([3, 4])
    expect(descendantsOf(layout, 4).size).toBe(0)
  })
})
