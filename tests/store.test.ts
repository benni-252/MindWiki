import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, NotAWikiError, autoBackup, openDatabase } from '../src/main/db'
import { extractArticleLinks } from '../src/main/links'
import { WikiError, WikiStore } from '../src/main/store'

const doc = (...linkIds: number[]): string =>
  JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hallo ' }, ...linkIds.map((id) => ({ type: 'articleLink', attrs: { id } }))]
      }
    ]
  })

let store: WikiStore
let root: number

beforeEach(() => {
  store = new WikiStore(openDatabase(':memory:', 'Mein Wiki'))
  root = store.rootId()
})

const titlesUnder = (parentId: number): string[] =>
  store
    .getTree()
    .articles.filter((a) => a.parentId === parentId)
    .sort((a, b) => a.position - b.position)
    .map((a) => a.title)

describe('Datenbank', () => {
  it('legt die Wurzel mit dem Wiki-Namen an', () => {
    const tree = store.getTree()
    expect(tree.articles).toHaveLength(1)
    expect(tree.articles[0]).toMatchObject({ id: root, parentId: null, title: 'Mein Wiki' })
  })

  it('lehnt fremde SQLite-Dateien ab', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindwiki-'))
    const file = path.join(dir, 'fremd.db')
    const foreign = new DatabaseSync(file)
    foreign.exec('CREATE TABLE kunden (id INTEGER)')
    foreign.close()
    expect(() => openDatabase(file, 'x')).toThrow(NotAWikiError)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('öffnet eine bestehende Datei wieder mit denselben Daten', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindwiki-'))
    const file = path.join(dir, 'wiki.db')
    const first = new WikiStore(openDatabase(file, 'Datei-Wiki'))
    first.createArticle(first.rootId(), 'Bleibt')
    first.db.close()
    const second = new WikiStore(openDatabase(file, 'anderer Name'))
    expect(second.getTree().articles.map((a) => a.title).sort()).toEqual(['Bleibt', 'Datei-Wiki'])
    second.db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('erstellt höchstens eine automatische Sicherung pro Tag', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindwiki-'))
    const file = path.join(dir, 'wiki.db')
    const s = new WikiStore(openDatabase(file, 'W'))
    expect(autoBackup(s.db, file)).not.toBeNull()
    expect(autoBackup(s.db, file)).toBeNull()
    expect(fs.readdirSync(path.join(dir, 'Sicherungen'))).toHaveLength(1)
    s.db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('Artikel', () => {
  it('hängt neue Artikel ans Ende oder hinter einen Geschwisterartikel', () => {
    const a = store.createArticle(root, 'A')
    store.createArticle(root, 'C')
    store.createArticle(root, 'B', a)
    expect(titlesUnder(root)).toEqual(['A', 'B', 'C'])
  })

  it('ändert die Reihenfolge unter Geschwistern', () => {
    store.createArticle(root, 'A')
    const b = store.createArticle(root, 'B')
    store.reorderArticle(b, -1)
    expect(titlesUnder(root)).toEqual(['B', 'A'])
    store.reorderArticle(b, -1) // schon ganz oben
    expect(titlesUnder(root)).toEqual(['B', 'A'])
  })

  it('verhindert Zyklen beim Umhängen', () => {
    const a = store.createArticle(root, 'A')
    const b = store.createArticle(a, 'B')
    expect(() => store.moveArticle(a, b)).toThrow(WikiError)
    expect(() => store.moveArticle(a, a)).toThrow(WikiError)
    expect(() => store.moveArticle(root, a)).toThrow(WikiError)
    store.moveArticle(b, root)
    expect(titlesUnder(root)).toEqual(['A', 'B'])
  })

  it('klappt den Elternartikel beim Anlegen eines Unterartikels auf', () => {
    const a = store.createArticle(root, 'A')
    store.setCollapsed(a, true)
    store.createArticle(a, 'Kind')
    expect(store.getTree().articles.find((x) => x.id === a)?.collapsed).toBe(false)
  })

  it('ersetzt leere Titel', () => {
    const a = store.createArticle(root, '   ')
    expect(store.getArticle(a)?.title).toBe('Ohne Titel')
  })
})

describe('Querverweise', () => {
  it('liest Artikel-Links aus dem TipTap-JSON', () => {
    expect(extractArticleLinks(doc(3, 5, 3))).toEqual([3, 5])
    expect(extractArticleLinks('kein json')).toEqual([])
    expect(extractArticleLinks(null)).toEqual([])
  })

  it('leitet Kanten beim Speichern ab und meldet Änderungen', () => {
    const a = store.createArticle(root, 'A')
    const b = store.createArticle(root, 'B')
    expect(store.saveArticleContent(a, doc(b, a, 9999), 'Hallo').treeChanged).toBe(true)
    expect(store.getTree().links).toEqual([{ fromId: a, toId: b }])
    expect(store.saveArticleContent(a, doc(b), 'Hallo').treeChanged).toBe(false)
    expect(store.saveArticleContent(a, doc(), 'Hallo').treeChanged).toBe(true)
    expect(store.getTree().links).toEqual([])
  })

  it('blendet Kanten zu Artikeln im Papierkorb aus', () => {
    const a = store.createArticle(root, 'A')
    const b = store.createArticle(root, 'B')
    store.saveArticleContent(a, doc(b), '')
    store.deleteArticle(b)
    expect(store.getTree().links).toEqual([])
    store.restoreArticle(b)
    expect(store.getTree().links).toHaveLength(1)
  })
})

describe('Papierkorb', () => {
  it('verschiebt den ganzen Ast und stellt ihn wieder her', () => {
    const a = store.createArticle(root, 'A')
    store.createArticle(a, 'A1')
    store.deleteArticle(a)
    expect(titlesUnder(root)).toEqual([])
    expect(store.listTrash()).toMatchObject([{ id: a, title: 'A', count: 2 }])
    store.restoreArticle(a)
    expect(titlesUnder(a)).toEqual(['A1'])
    expect(store.listTrash()).toEqual([])
  })

  it('hängt einen Ast unter die Wurzel, wenn sein Elternartikel noch gelöscht ist', async () => {
    const a = store.createArticle(root, 'A')
    const child = store.createArticle(a, 'Kind')
    store.deleteArticle(child)
    await new Promise((r) => setTimeout(r, 5)) // anderer Zeitstempel
    store.deleteArticle(a)
    expect(store.listTrash().map((t) => t.title)).toEqual(['A', 'Kind'])
    store.restoreArticle(child)
    expect(titlesUnder(root)).toEqual(['Kind'])
  })

  it('löscht endgültig samt Abläufen', () => {
    const a = store.createArticle(root, 'A')
    const list = store.createChecklist(a, 'Ablauf')
    store.addItem(list, 'Schritt')
    store.deleteArticle(a)
    store.purgeArticle(a)
    expect(store.listTrash()).toEqual([])
    expect(store.getChecklists(a)).toEqual([])
  })

  it('speichert eine letzte Änderung auch nach dem Löschen', () => {
    const a = store.createArticle(root, 'A')
    store.deleteArticle(a)
    store.saveArticleContent(a, doc(), 'letzter Stand')
    store.restoreArticle(a)
    expect(store.search('letzter').map((h) => h.id)).toEqual([a])
  })

  it('schützt die Wurzel', () => {
    expect(() => store.deleteArticle(root)).toThrow(WikiError)
  })
})

describe('Abläufe', () => {
  it('speichert Haken, protokolliert Durchläufe und setzt zurück', () => {
    const a = store.createArticle(root, 'A')
    const list = store.createChecklist(a, 'Server neu starten')
    const s1 = store.addItem(list, 'Dienst stoppen')
    store.addItem(list, 'Neustart')
    store.setItemChecked(s1, true)

    expect(store.getTree().articles.find((x) => x.id === a)).toMatchObject({ checkTotal: 2, checkDone: 1 })

    store.completeRun(list, '  Wartungsfenster  ')
    const [run] = store.getRuns(list)
    expect(run.note).toBe('Wartungsfenster')
    expect(run.snapshot).toEqual([
      { text: 'Dienst stoppen', checked: true },
      { text: 'Neustart', checked: false }
    ])
    expect(store.getChecklists(a)[0].items.every((i) => !i.checked)).toBe(true)
  })

  it('verschiebt Schritte', () => {
    const a = store.createArticle(root, 'A')
    const list = store.createChecklist(a, 'L')
    store.addItem(list, 'eins')
    const zwei = store.addItem(list, 'zwei')
    store.moveItem(zwei, -1)
    expect(store.getChecklists(a)[0].items.map((i) => i.text)).toEqual(['zwei', 'eins'])
  })
})

describe('Suche', () => {
  it('findet Titel, Text und Checklisten, Umlaute ohne Groß-/Kleinschreibung', () => {
    const a = store.createArticle(root, 'Übersicht Netzwerk')
    const b = store.createArticle(root, 'Drucker')
    store.saveArticleContent(b, doc(), 'Der Drucker hängt am Netzwerk im Büro.')
    const c = store.createArticle(root, 'Backup')
    store.addItem(store.createChecklist(c, 'Nachtlauf'), 'Festplatte prüfen')

    expect(store.search('übersicht').map((h) => h.id)).toEqual([a])
    expect(store.search('netzwerk').map((h) => h.id)).toEqual([a, b])
    expect(store.search('festplatte').map((h) => h.id)).toEqual([c])
    expect(store.search('büro drucker')[0].snippet).toContain('Büro')
  })
})

describe('IT-Funktionen', () => {
  it('aktualisiert eine Datenbank der Version 1 und sichert sie vorher', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindwiki-'))
    const file = path.join(dir, 'Alt.db')
    const old = new DatabaseSync(file)
    old.exec(MIGRATIONS[0])
    old.exec("PRAGMA user_version = 1; INSERT INTO meta VALUES ('app', 'mindwiki'); INSERT INTO articles (title) VALUES ('Alt')")
    old.close()

    const s = new WikiStore(openDatabase(file, 'Alt'))
    const rootId = s.rootId()
    s.setArticleIcon(rootId, 'server')
    s.addField(rootId, 'IP-Adresse', '10.0.0.1')
    expect(s.getTree().articles[0]).toMatchObject({ title: 'Alt', icon: 'server' })
    expect(fs.existsSync(path.join(dir, 'Sicherungen', 'Alt_vor-Update-v1.db'))).toBe(true)
    s.db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('verwaltet Steckbrief-Felder und findet sie in der Suche', () => {
    const a = store.createArticle(root, 'Domain Controller')
    const ip = store.addField(a, 'IP-Adresse', ' 10.0.0.10 ')
    const host = store.addField(a, 'Hostname', 'SRV-DC01')
    store.moveField(host, -1)
    expect(store.getFields(a).map((f) => [f.label, f.value])).toEqual([
      ['Hostname', 'SRV-DC01'],
      ['IP-Adresse', '10.0.0.10']
    ])
    expect(store.search('10.0.0.10')).toMatchObject([{ id: a, snippet: expect.stringContaining('IP-Adresse: 10.0.0.10') }])
    store.updateField(ip, 'IP-Adresse', '10.0.0.11')
    expect(store.search('10.0.0.10')).toEqual([])
    store.deleteField(ip)
    expect(store.getFields(a)).toHaveLength(1)
  })

  it('legt Artikel aus einer Vorlage an', () => {
    const id = store.createArticle(root, 'SRV-DC01', null, 'server')
    const article = store.getArticle(id)!
    expect(store.getTree().articles.find((a) => a.id === id)).toMatchObject({ icon: 'server', hasText: true })
    expect(article.content).toContain('Konfiguration')
    expect(store.getFields(id).map((f) => f.label)).toContain('IP-Adresse')
    const [list] = store.getChecklists(id)
    expect(list.title).toBe('Wartung / Neustart')
    expect(list.items.length).toBeGreaterThan(3)
    expect(() => store.createArticle(root, 'X', null, 'gibt-es-nicht')).toThrow(WikiError)
  })

  it('wendet Vorlagen an, ohne Vorhandenes zu überschreiben', () => {
    const id = store.createArticle(root, 'Drucker')
    store.saveArticleContent(id, doc(), 'Eigener Text')
    store.setArticleIcon(id, 'printer')
    store.addField(id, 'hostname', 'PRN-01')
    store.applyTemplate(id, 'network')
    expect(store.getArticle(id)!.content).not.toContain('Ports')
    expect(store.getTree().articles.find((a) => a.id === id)!.icon).toBe('printer')
    const labels = store.getFields(id).map((f) => f.label.toLowerCase())
    expect(labels.filter((l) => l === 'hostname')).toHaveLength(1)
    expect(labels).toContain('firmware')
    expect(store.getChecklists(id).map((c) => c.title)).toEqual(['Firmware-Update'])
  })
})

describe('Bilder', () => {
  it('speichert Bilder und räumt verwaiste auf', () => {
    const a = store.createArticle(root, 'A')
    const used = store.saveImage('image/png', new Uint8Array([1, 2, 3]))
    store.saveImage('image/png', new Uint8Array([4]))
    store.saveArticleContent(
      a,
      JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { src: used } }] }),
      ''
    )
    expect(store.cleanupImages()).toBe(1)
    const id = Number(used.split('/').pop())
    expect(store.getImage(id)?.data).toEqual(new Uint8Array([1, 2, 3]))
    expect(() => store.saveImage('text/html', new Uint8Array())).toThrow(WikiError)
  })
})
