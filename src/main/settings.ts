import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

interface Settings {
  lastDbPath?: string
  /** Name im Verlauf; leer = Windows-Benutzername */
  userName?: string
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

export function defaultDbPath(): string {
  return path.join(app.getPath('documents'), 'MindWiki', 'Wiki.db')
}

function loginName(): string {
  try {
    return os.userInfo().username || 'Unbekannt'
  } catch {
    return 'Unbekannt'
  }
}

/** Name, unter dem eigene Änderungen im Verlauf erscheinen. */
export function userName(): string {
  return loadSettings().userName?.trim() || loginName()
}
