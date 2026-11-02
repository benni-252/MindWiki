import fs from 'node:fs'
import path from 'node:path'
import { autoBackup, openDatabase } from './db'
import { saveSettings, userName } from './settings'
import { WikiStore } from './store'

// Die aktuell geöffnete Wiki-Datei. Es ist immer genau eine offen.
let store: WikiStore | null = null
let dbFile = ''
let onChange: (() => void) | null = null

export function onWikiChange(listener: () => void): void {
  onChange = listener
}

export function currentStore(): WikiStore {
  if (!store) throw new Error('Es ist kein Wiki geöffnet.')
  return store
}

/** Das geöffnete Wiki oder null (z. B. während des Beendens). */
export function peekStore(): WikiStore | null {
  return store
}

export function currentDbFile(): string {
  return dbFile
}

export function wikiName(file = dbFile): string {
  return path.basename(file, path.extname(file))
}

/** Öffnet bzw. erstellt eine Wiki-Datei und schließt die bisherige erst, wenn das geklappt hat. */
export function openWiki(file: string): void {
  const existed = fs.existsSync(file) && fs.statSync(file).size > 0
  const next = new WikiStore(openDatabase(file, wikiName(file)), userName())
  if (existed) {
    try {
      autoBackup(next.db, file)
    } catch (err) {
      console.error('Automatische Sicherung fehlgeschlagen', err)
    }
  }
  next.cleanupImages()
  store?.db.close()
  store = next
  dbFile = file
  saveSettings({ lastDbPath: file })
  onChange?.()
}

export function closeWiki(): void {
  store?.db.close()
  store = null
}
