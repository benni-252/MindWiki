import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { extractArticleLinks } from '../src/main/links'
import { ensureSampleWiki, fillSampleTasks, fillSampleWiki } from '../src/main/sample'
import { WikiStore } from '../src/main/store'
import { computeImpact } from '../src/shared/impact'

describe('Beispiel-Wiki', () => {
  it('füllt ein leeres Wiki mit zusammenhängenden Beispieldaten', () => {
    const store = new WikiStore(openDatabase(':memory:', 'Beispiel-Wiki'), 'Test')
    fillSampleWiki(store)
    const tree = store.getTree()
    const byTitle = (title: string) => tree.articles.find((a) => a.title === title)!

    expect(tree.articles.length).toBeGreaterThanOrEqual(20)
    expect(tree.articles.every((a) => a.approved)).toBe(true)
    expect(byTitle('Server').icon).toBe('server')

    // Steckbrief, Suche, Abläufe mit Protokoll
    expect(store.getFields(byTitle('SRV-SQL01').id).find((f) => f.label === 'IP-Adresse')?.value).toBe('10.0.10.20')
    expect(store.getFields(byTitle('Core-Switch').id).every((f) => f.value !== '')).toBe(true)
    expect(store.search('10.0.10.20').map((h) => h.title)).toContain('SRV-SQL01')
    const runs = store.getChecklists(byTitle('SRV-DC01').id).flatMap((l) => store.getRuns(l.id))
    expect(runs).toHaveLength(1)
    expect(store.getChecklists(byTitle('Neuer Mitarbeiter').id)[0]).toMatchObject({ title: 'Einrichtung' })

    // Störung mit Auswirkungen über mehrere Stufen
    const sql = byTitle('SRV-SQL01')
    expect(sql.outageNote).toMatch(/^Beispiel:/)
    const impact = computeImpact([sql.id], tree.dependencies)
    const affected = [...impact.affected.keys()].map((id) => tree.articles.find((a) => a.id === id)!.title)
    expect(affected.sort()).toEqual(['SRV-APP01', 'Warenwirtschaft'])

    // Querverweise zeigen auf vorhandene Artikel, Verlauf von zwei Personen
    const ids = new Set(tree.articles.map((a) => a.id))
    expect(tree.links.length).toBeGreaterThan(10)
    expect(extractArticleLinks(store.getArticle(tree.rootId)!.content).every((id) => ids.has(id))).toBe(true)
    expect(new Set(store.getRecentChanges(500).map((c) => c.author))).toEqual(new Set(['Anna', 'Ben']))
    expect(byTitle('Dienstleister').collapsed).toBe(true)
  })

  it('bringt Beispiel-Aufgaben mit – auch für ältere Beispiel-Wikis, aber nur einmal', () => {
    const store = new WikiStore(openDatabase(':memory:', 'Beispiel-Wiki'), 'Test')
    fillSampleWiki(store)
    store.createUser('Anna', 'demo', 'editor')
    store.createUser('Ben', 'demo', 'author')
    store.author = 'Test'
    expect(fillSampleTasks(store, new Date(2026, 10, 20))).toBe(true)
    const board = store.tasks.getTaskBoard()
    expect(board.buckets.map((b) => b.name)).toEqual(['Zu erledigen', 'Diese Woche', 'Warten auf andere'])
    expect(board.labels.map((l) => l.name)).toEqual(['Server', 'Netzwerk', 'Arbeitsplatz', 'Einkauf', 'Sicherheit'])
    expect(board.tasks).toHaveLength(7)
    const byTitle = (start: string) => board.tasks.find((t) => t.title.startsWith(start))!
    expect(byTitle('Laufwerk D:')).toMatchObject({
      priority: 'urgent',
      progress: 'active',
      dueDate: '2026-11-20',
      assignees: ['Anna', 'Ben'],
      articleTitle: 'SRV-SQL01',
      preview: 'checklist',
      commentCount: 1
    })
    expect(byTitle('VPN-Zertifikat').dueDate).toBe('2026-11-19')
    expect(byTitle('Toner')).toMatchObject({ progress: 'done', completedBy: 'Ben' })
    // Reihenfolge wie angelegt, alle verknüpften Artikel gibt es
    const week = board.buckets[1].id
    expect(
      board.tasks
        .filter((t) => t.bucketId === week)
        .sort((a, b) => a.position - b.position)
        .map((t) => t.title.split(' ')[0])
    ).toEqual(['Laufwerk', 'Arbeitsplatz', 'VPN-Zertifikat'])
    expect(board.tasks.filter((t) => t.articleId != null).every((t) => t.articleTitle)).toBe(true)
    expect(store.author).toBe('Test')

    // Nur einmal – auch wenn danach alles gelöscht wird
    for (const b of board.buckets) store.tasks.deleteBucket(b.id)
    expect(fillSampleTasks(store)).toBe(false)
    expect(store.tasks.getTaskBoard().tasks).toHaveLength(0)
  })

  it('legt die Beispiel-Datei nur einmal an und kennzeichnet sie', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindwiki-'))
    const file = path.join(dir, 'MindWiki', 'Beispiel-Wiki.db')
    ensureSampleWiki(file)
    const first = new WikiStore(openDatabase(file, 'x'))
    const count = first.getTree().articles.length
    expect(first.isSample()).toBe(true)
    expect(first.tasks.getTaskBoard().tasks.length).toBeGreaterThan(0)
    first.renameArticle(first.rootId(), 'Umbenannt')
    first.db.close()

    ensureSampleWiki(file)
    const again = new WikiStore(openDatabase(file, 'x'))
    expect(again.getTree().articles).toHaveLength(count)
    expect(again.getTree().articles.find((a) => a.id === again.rootId())?.title).toBe('Umbenannt')
    again.db.close()

    const normal = new WikiStore(openDatabase(':memory:', 'Normal'))
    expect(normal.isSample()).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
