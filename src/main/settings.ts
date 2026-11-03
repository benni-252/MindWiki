import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

interface Settings {
  lastDbPath?: string
  /** Zuletzt angemeldeter Benutzer (zum Vorausfüllen der Anmeldung) */
  lastUser?: string
  /** Gemerkte Proxy-Anmeldungen je „host:port“; Passwort verschlüsselt (safeStorage, Base64) */
  proxyLogins?: Record<string, { username: string; password: string }>
}

const file = (): string => path.join(app.getPath('userData'), 'settings.json')

export function loadSettings(): Settings {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8')) as Settings
  } catch {
    return {}
  }
}

export function saveSettings(patch: Partial<Settings>): void {
  const next = { ...loadSettings(), ...patch }
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8')
}

/** Ordner für Wiki-Dateien; MINDWIKI_DOCUMENTS ersetzt ihn in automatischen Tests. */
function wikiFolder(): string {
  return path.join(process.env.MINDWIKI_DOCUMENTS || app.getPath('documents'), 'MindWiki')
}

export function defaultDbPath(): string {
  return path.join(wikiFolder(), 'Wiki.db')
}

export function sampleDbPath(): string {
  return path.join(wikiFolder(), 'Beispiel-Wiki.db')
}
