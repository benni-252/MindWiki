import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../src/main/db'
import { docText } from '../src/main/links'
import { KEEP_TEXT_VERSIONS, TEXT_MERGE_MS, WikiError, WikiStore } from '../src/main/store'

const textDoc = (text: string): string =>
  JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

let store: WikiStore
let root: number

beforeEach(() => {
  store = new WikiStore(openDatabase(':memory:', 'Team'), 'Anna')
  root = store.rootId()
})

afterEach(() => {
  vi.useRealTimers()
})

const summaries = (id: number): string[] => store.getChanges(id).map((c) => `${c.author}: ${c.summary}`)

describe('Verlauf', () => {
  it('protokolliert, wer was geändert hat', () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T10:00:00Z'), toFake: ['Date'] })
    const fw = store.createArticle(root, 'Neuer Artikel')
    // direkt nach dem Anlegen benennen: kein eigener Eintrag
    store.renameArticle(fw, 'Firewall')
    store.renameArticle(fw, 'Firewall')
    vi.setSystemTime(Date.now() + 10 * 60_000)
    store.renameArticle(fw, 'Firewall Zentrale')
    store.author = 'Ben'
    const ip = store.addField(fw, 'IP-Adresse', '10.0.0.1')
    store.updateField(ip, 'IP-Adresse', '10.0.0.2')
    store.updateField(ip, 'IP-Adresse', '10.0.0.2')
    store.setArticleIcon(fw, 'router')
    const list = store.createChecklist(fw, 'Neustart')
    store.addItem(list, 'Konfiguration sichern')
    store.completeRun(list, null)
    store.reportOutage(fw, 'Lüfter defekt')
    store.resolveOutage(fw)
    store.resolveOutage(fw)

    expect(summaries(fw).reverse()).toEqual([
      'Anna: Angelegt',
      'Anna: Titel geändert: „Firewall“ → „Firewall Zentrale“',
      'Ben: Feld „IP-Adresse“ hinzugefügt: „10.0.0.1“',
      'Ben: IP-Adresse: „10.0.0.1“ → „10.0.0.2“',
      'Ben: Symbol geändert',
      'Ben: Ablauf „Neustart“ angelegt',
      'Ben: Schritt „Konfiguration sichern“ zu „Neustart“ hinzugefügt',
      'Ben: Ablauf „Neustart“ durchgeführt (0/1 Schritte)',
      'Ben: Störung gemeldet: „Lüfter defekt“',
      'Ben: Störung behoben'
    ])
  })

  it('schreibt keine Passwörter in den Verlauf', () => {
    const a = store.createArticle(root, 'Router')
    const pw = store.addField(a, 'Passwort', 'geheim1')
    store.updateField(pw, 'Passwort', 'geheim2')
    store.deleteField(pw)
    const text = summaries(a).join('\n')
    expect(text).toContain('Feld „Passwort“ hinzugefügt')
    expect(text).toContain('Passwort: Wert geändert')
    expect(text).not.toMatch(/geheim/)
  })

  it('fasst Vorlagen zu einem Eintrag zusammen und protokolliert Abhängigkeiten auf beiden Seiten', () => {
    const srv = store.createArticle(root, 'SRV', null, 'server')
    expect(summaries(srv)).toEqual(['Anna: Angelegt aus der Vorlage „Server / System“'])
    const app = store.createArticle(root, 'App')
    store.addDependency(app, srv)
    store.addDependency(app, srv)
    expect(summaries(app)[0]).toBe('Anna: Abhängigkeit hinzugefügt: hängt ab von „SRV“')
    expect(summaries(srv)[0]).toBe('Anna: Abhängigkeit hinzugefügt: „App“ hängt hiervon ab')
    expect(store.getChanges(srv)).toHaveLength(2)
  })

  it('fasst Textänderungen einer Person zusammen und hebt die Fassung davor auf', () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T10:00:00Z'), toFake: ['Date'] })
    const a = store.createArticle(root, 'Anleitung')
    store.saveArticleContent(a, textDoc('Version 1'), 'Version 1')
    store.saveArticleContent(a, textDoc('Version 1b'), 'Version 1b')
    store.saveArticleContent(a, textDoc('Version 1b'), 'Version 1b')
    let texts = store.getChanges(a).filter((c) => c.kind === 'text')
    expect(texts).toHaveLength(1)
    expect(texts[0].hasVersion).toBe(false)

    // Andere Person: eigener Eintrag mit der Fassung davor
    store.author = 'Ben'
    store.saveArticleContent(a, textDoc('Version 2'), 'Version 2')
    // Gleiche Person, aber später: wieder ein eigener Eintrag
    vi.setSystemTime(Date.now() + TEXT_MERGE_MS + 1000)
    store.saveArticleContent(a, textDoc('Version 3'), 'Version 3')

    texts = store.getChanges(a).filter((c) => c.kind === 'text')
    expect(texts.map((c) => [c.author, c.hasVersion])).toEqual([
      ['Ben', true],
      ['Ben', true],
      ['Anna', false]
    ])
    expect(docText(store.getTextVersion(texts[1].id))).toBe('Version 1b')
    expect(docText(store.getTextVersion(texts[0].id))).toBe('Version 2')

    // Zurücksetzen auf die Fassung vor Bens erster Änderung
    store.author = 'Anna'
    store.restoreTextVersion(texts[1].id)
    expect(docText(store.getArticle(a)!.content)).toBe('Version 1b')
    const latest = store.getChanges(a)[0]
    expect(latest).toMatchObject({ author: 'Anna', kind: 'text', hasVersion: true })
    expect(latest.summary).toMatch(/^Text auf die Fassung vor der Änderung von Ben \(.+\) zurückgesetzt$/)
    expect(docText(store.getTextVersion(latest.id))).toBe('Version 3')
    expect(store.search('Version 1b').map((h) => h.id)).toEqual([a])
  })

  it('behält nur eine begrenzte Zahl alter Fassungen', () => {
    const a = store.createArticle(root, 'Viel')
    for (let i = 0; i < KEEP_TEXT_VERSIONS + 5; i++) {
      store.author = `Person ${i}`
      store.saveArticleContent(a, textDoc(`Stand ${i}`), `Stand ${i}`)
    }
    const versions = store.getChanges(a).filter((c) => c.hasVersion)
    expect(versions).toHaveLength(KEEP_TEXT_VERSIONS)
    expect(() => store.restoreTextVersion(store.getChanges(a).at(-1)!.id)).toThrow(WikiError)
  })

  it('meldet im Baum die letzte eigene und fremde Änderung', () => {
    const a = store.createArticle(root, 'A')
    const summary = () => store.getTree().articles.find((x) => x.id === a)!
    expect(summary()).toMatchObject({ lastChangeBy: 'Anna', lastOtherChangeAt: null })
    store.author = 'Ben'
    store.renameArticle(a, 'B')
    store.author = 'Anna'
    expect(summary()).toMatchObject({ lastChangeBy: 'Ben', lastOtherChangeBy: 'Ben' })
    expect(summary().lastOtherChangeAt).toBe(summary().lastChangeAt)
  })

  it('nimmt bei Änderungen in derselben Millisekunde die später eingetragene', () => {
    // Auf schnellen Rechnern bekommen Anlegen und Umbenennen oft denselben Zeitstempel
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-04T08:00:00.000Z'))
    try {
      const a = store.createArticle(root, 'A')
      store.author = 'Ben'
      store.renameArticle(a, 'B')
      store.author = 'Carla'
      store.renameArticle(a, 'C')
      store.author = 'Anna'
      const summary = store.getTree().articles.find((x) => x.id === a)!
      expect(summary).toMatchObject({ lastChangeBy: 'Carla', lastOtherChangeBy: 'Carla' })
      expect(store.getChanges(a)[0].author).toBe('Carla')
    } finally {
      vi.useRealTimers()
    }
  })

  it('listet die letzten Änderungen im ganzen Wiki, auch im Papierkorb', () => {
    const a = store.createArticle(root, 'Alt')
    store.createArticle(root, 'Neu')
    store.deleteArticle(a)
    const recent = store.getRecentChanges(10)
    expect(recent.map((c) => [c.title, c.summary, c.deleted])).toEqual([
      ['Alt', 'In den Papierkorb verschoben', true],
      ['Neu', 'Angelegt', false],
      ['Alt', 'Angelegt', true]
    ])
  })

  it('löscht Bilder nicht, solange eine alte Fassung sie noch zeigt', () => {
    const a = store.createArticle(root, 'Bild')
    const url = store.saveImage('image/png', new Uint8Array([1]))
    store.saveArticleContent(a, JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { src: url } }] }), '')
    store.author = 'Ben'
    store.saveArticleContent(a, textDoc('ohne Bild'), 'ohne Bild')
    expect(store.cleanupImages()).toBe(0)
  })
})

describe('Suche im Verlauf', () => {
  it('findet Änderungen nach Artikel, Person, Beschreibung und Datum', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-11-03T09:00:00'))
      const fw = store.createArticle(root, 'Firewall Zentrale')
      vi.setSystemTime(new Date('2026-11-04T10:00:00'))
      store.author = 'Björn'
      store.addField(fw, 'IP-Adresse', '10.0.0.1')
      const srv = store.createArticle(root, 'Server Öst')
      store.author = 'Anna'
      store.renameArticle(srv, 'Server Ost')

      const found = (q: string) => store.searchChanges(q, 50).map((c) => `${c.author}: ${c.summary}`)
      // Person – Groß-/Kleinschreibung und Umlaute egal
      expect(found('BJÖRN')).toEqual(['Björn: Angelegt', 'Björn: Feld „IP-Adresse“ hinzugefügt: „10.0.0.1“'])
      // Beschreibung: Wert aus dem Steckbrief, alter Titel
      expect(found('10.0.0.1')).toEqual(['Björn: Feld „IP-Adresse“ hinzugefügt: „10.0.0.1“'])
      expect(found('öst')).toEqual(['Anna: Titel geändert: „Server Öst“ → „Server Ost“'])
      // Artikel (aktueller Name) und mehrere Wörter: alle müssen vorkommen
      expect(found('firewall angelegt')).toEqual(['Anna: Angelegt'])
      expect(found('firewall björn')).toEqual(['Björn: Feld „IP-Adresse“ hinzugefügt: „10.0.0.1“'])
      // Datum, mit und ohne führende Null
      expect(found('03.11.2026')).toEqual(['Anna: Angelegt'])
      expect(found('3.11.2026')).toEqual(['Anna: Angelegt'])
      expect(found('gibt es nicht')).toEqual([])
      // Leere Suche = die neuesten Änderungen, Höchstzahl wird beachtet
      expect(store.searchChanges('  ', 2)).toHaveLength(2)
      expect(store.searchChanges('server', 1)).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('zeigt keine Änderungen aus noch nicht freigegebenen Entwürfen', () => {
    store.setApprovalRequired(true)
    const a = store.createArticle(root, 'Handbuch')
    store.author = 'Ben'
    store.approve(a)
    store.author = 'Anna'
    const draft = store.startDraft(a)
    store.addField(draft, 'Geheimprojekt', 'x')
    expect(store.searchChanges('Geheimprojekt', 10)).toEqual([])
    expect(store.searchChanges('Handbuch', 10).map((c) => c.summary)).toContain('Neuen Artikel von Anna freigegeben')
  })
})

describe('Gemeinsame Datei', () => {
  it('erlaubt zwei Verbindungen gleichzeitig und erkennt fremde Änderungen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindwiki-'))
    const file = path.join(dir, 'Team.db')
    const anna = new WikiStore(openDatabase(file, 'Team'), 'Anna')
    const ben = new WikiStore(openDatabase(file, 'Team'), 'Ben')
    expect(anna.db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' })

    const before = anna.dataVersion()
    const id = ben.createArticle(ben.rootId(), 'Von Ben')
    expect(anna.dataVersion()).not.toBe(before)
    const seen = anna.dataVersion()
    anna.renameArticle(id, 'Von Anna umbenannt')
    expect(anna.dataVersion()).toBe(seen)

    expect(anna.getTree().articles.find((a) => a.id === id)).toMatchObject({ lastChangeBy: 'Anna' })
    expect(ben.getChanges(id).map((c) => c.author)).toEqual(['Anna', 'Ben'])
    anna.db.close()
    ben.db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('stellt Dateien älterer Versionen von WAL auf das normale Journal um', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindwiki-'))
    const file = path.join(dir, 'Alt.db')
    const old = openDatabase(file, 'Alt')
    old.exec('PRAGMA journal_mode = WAL')
    old.close()
    const s = openDatabase(file, 'Alt')
    expect(s.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' })
    s.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('docText', () => {
  it('macht aus TipTap-JSON lesbaren Text', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Titel' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Siehe ' },
            { type: 'articleLink', attrs: { id: 3, label: 'Server' } }
          ]
        },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Punkt' }] }] }] }
      ]
    })
    expect(docText(doc)).toBe('Titel\nSiehe Server\nPunkt')
    expect(docText('kaputt')).toBe('')
  })
})
