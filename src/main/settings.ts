import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

interface Settings {
  lastDbPath?: string
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
