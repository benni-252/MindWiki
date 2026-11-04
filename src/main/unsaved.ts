import fs from 'node:fs'
import path from 'node:path'
import type { UnsavedText } from '../shared/types'

// Sicherheitskopie von Artikeltexten, die nicht gespeichert werden konnten (z. B. Netzlaufwerk weg).
// Liegt auf diesem Rechner im Benutzerordner, nicht neben der Wiki-Datei – sonst wäre sie mit weg.

interface Entry extends UnsavedText {
  /** Wiki-Datei, zu der der Text gehört */
  db: string
  user: string
}

/** Vergleichsschlüssel für die Wiki-Datei (Windows unterscheidet keine Groß-/Kleinschreibung). */
export function dbKey(file: string): string {
  const resolved = path.resolve(file)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export class UnsavedStore {
  constructor(private readonly file: string) {}

  /** Texte dieses Benutzers in dieser Wiki-Datei, neueste zuerst. */
  list(db: string, user: string): UnsavedText[] {
    return this.read()
      .filter((e) => this.mine(e, db, user))
      .map(({ db: _db, user: _user, ...text }) => text)
      .sort((a, b) => b.at.localeCompare(a.at))
  }

  keep(db: string, user: string, text: UnsavedText): void {
    const entries = this.read().filter((e) => !(this.mine(e, db, user) && e.contentId === text.contentId))
    entries.push({ ...text, db, user })
    this.write(entries)
  }

  drop(db: string, user: string, contentId: number): void {
    const entries = this.read()
    const rest = entries.filter((e) => !(this.mine(e, db, user) && e.contentId === contentId))
    if (rest.length !== entries.length) this.write(rest)
  }

  private mine(e: Entry, db: string, user: string): boolean {
    return e.db === db && e.user.toLowerCase() === user.toLowerCase()
  }

  private read(): Entry[] {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown
      return Array.isArray(data) ? (data as Entry[]) : []
    } catch {
      return []
    }
  }

  /** Erst in eine Hilfsdatei, dann umbenennen: Ein Absturz mittendrin hinterlässt nie eine halbe Datei. */
  private write(entries: Entry[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 1), 'utf8')
    fs.renameSync(tmp, this.file)
  }
}
