import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { friendlyDbError, UNREACHABLE } from '../src/main/dbErrors'
import { WikiError, WikiStore } from '../src/main/store'
import { dbKey, UnsavedStore } from '../src/main/unsaved'

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindwiki-unsaved-'))
  file = path.join(dir, 'Nicht-gespeichert.json')
})

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const text = (contentId: number, content: string, at = '2026-11-04T08:00:00.000Z') => ({
  articleId: contentId,
  contentId,
  title: `Artikel ${contentId}`,
  content,
  text: content,
  at
})

describe('Sicherheitskopie nicht gespeicherter Texte', () => {
  it('hebt Texte je Wiki-Datei und Benutzer auf und überschreibt ältere Stände', () => {
    const store = new UnsavedStore(file)
    const wiki = dbKey('/netz/Team.db')
    store.keep(wiki, 'Anna', text(1, 'eins'))
    store.keep(wiki, 'Anna', text(1, 'eins, länger', '2026-11-04T08:05:00.000Z'))
    store.keep(wiki, 'Anna', text(2, 'zwei', '2026-11-04T09:00:00.000Z'))
    store.keep(wiki, 'Ben', text(1, 'von Ben'))
    store.keep(dbKey('/netz/Anderes.db'), 'Anna', text(1, 'anderes Wiki'))

    // Neue Instanz = nach einem Neustart
    const again = new UnsavedStore(file)
    expect(again.list(wiki, 'anna').map((t) => t.content)).toEqual(['zwei', 'eins, länger'])
    expect(again.list(wiki, 'Ben').map((t) => t.content)).toEqual(['von Ben'])

    again.drop(wiki, 'Anna', 1)
    expect(again.list(wiki, 'Anna').map((t) => t.contentId)).toEqual([2])
    expect(again.list(wiki, 'Ben')).toHaveLength(1)
    expect(fs.existsSync(`${file}.tmp`)).toBe(false)
  })

  it('kommt mit fehlender oder kaputter Datei zurecht', () => {
    const store = new UnsavedStore(path.join(dir, 'neu', 'Nicht-gespeichert.json'))
    expect(store.list('x', 'Anna')).toEqual([])
    store.keep('x', 'Anna', text(1, 'eins'))
    expect(store.list('x', 'Anna')).toHaveLength(1)

    fs.writeFileSync(file, '{ kaputt')
    expect(new UnsavedStore(file).list('x', 'Anna')).toEqual([])
  })
})

describe('Fehler der Wiki-Datei', () => {
  it('meldet eine gesperrte Datei verständlich statt „database is locked“', () => {
    const dbFile = path.join(dir, 'Team.db')
    const store = new WikiStore(openDatabase(dbFile, 'Team'), 'Anna')
    store.db.exec('PRAGMA busy_timeout = 50')
    const root = store.rootId()
    // Ein anderer Rechner (oder ein hängendes Netzlaufwerk) hält die Datei gesperrt
    const other = new DatabaseSync(dbFile)
    other.exec('BEGIN EXCLUSIVE')
    try {
      let caught: unknown
      try {
        store.createArticle(root, 'Server')
      } catch (err) {
        caught = err
      }
      expect(String((caught as Error).message)).toMatch(/locked/)
      const friendly = friendlyDbError(caught)
      expect(friendly).toBeInstanceOf(WikiError)
      expect((friendly as Error).message).toMatch(/gesperrt oder nicht erreichbar/)
    } finally {
      other.exec('ROLLBACK')
      other.close()
    }
    // Danach geht es normal weiter – nichts ist halb gespeichert
    store.createArticle(root, 'Server')
    expect(store.getTree().articles.map((a) => a.title)).toContain('Server')
    store.db.close()
  })

  it('übersetzt typische SQLite-Fehler und lässt andere Fehler in Ruhe', () => {
    const sqlite = (errcode: number) => Object.assign(new Error('x'), { code: 'ERR_SQLITE_ERROR', errcode })
    expect((friendlyDbError(sqlite(10)) as Error).message).toBe(UNREACHABLE)
    expect((friendlyDbError(sqlite(266)) as Error).message).toBe(UNREACHABLE) // SQLITE_IOERR_READ
    expect((friendlyDbError(sqlite(14)) as Error).message).toBe(UNREACHABLE)
    expect((friendlyDbError(sqlite(8)) as Error).message).toMatch(/schreibgeschützt/)
    expect((friendlyDbError(sqlite(13)) as Error).message).toMatch(/kein Platz/)
    expect((friendlyDbError(sqlite(11)) as Error).message).toMatch(/beschädigt/)
    const other = new Error('anders')
    expect(friendlyDbError(other)).toBe(other)
    expect(friendlyDbError(sqlite(1))).toBeInstanceOf(Error)
  })
})
