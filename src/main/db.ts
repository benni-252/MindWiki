import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

export const APP_MARKER = 'mindwiki'

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"

// Jede Migration hebt PRAGMA user_version um eins an. Nur anhängen, nie ändern.
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE articles (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER REFERENCES articles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT,
    content_text TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    collapsed INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (${NOW}),
    updated_at TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_articles_parent ON articles(parent_id, position);
  CREATE TABLE links (
    from_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    to_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    PRIMARY KEY (from_id, to_id)
  ) WITHOUT ROWID;
  CREATE INDEX idx_links_to ON links(to_id);
  CREATE TABLE checklists (
    id INTEGER PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_checklists_article ON checklists(article_id, position);
  CREATE TABLE checklist_items (
    id INTEGER PRIMARY KEY,
    checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    checked INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT
  );
  CREATE INDEX idx_items_checklist ON checklist_items(checklist_id, position);
  CREATE TABLE checklist_runs (
    id INTEGER PRIMARY KEY,
    checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
    completed_at TEXT NOT NULL,
    note TEXT,
    snapshot TEXT NOT NULL
  );
  CREATE INDEX idx_runs_checklist ON checklist_runs(checklist_id, completed_at);
  CREATE TABLE images (
    id INTEGER PRIMARY KEY,
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${NOW})
  );
  `,
  // v2: Symbole an Knoten und Steckbrief-Felder
  `
  ALTER TABLE articles ADD COLUMN icon TEXT;
  CREATE TABLE article_fields (
    id INTEGER PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_fields_article ON article_fields(article_id, position);
  `
]

export class NotAWikiError extends Error {}

/**
 * Öffnet (oder erstellt) eine Wiki-Datenbank, spielt Migrationen ein und legt bei Bedarf
 * die Wurzel mit `rootTitle` an. Fremde SQLite-Dateien werden abgelehnt.
 */
export function openDatabase(file: string, rootTitle: string): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL')

    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (version === 0) {
      const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }
      if (tables.n > 0) throw new NotAWikiError('Diese Datei ist keine MindWiki-Datenbank.')
    } else {
      const marker = db.prepare("SELECT value FROM meta WHERE key = 'app'").get() as { value: string } | undefined
      if (marker?.value !== APP_MARKER) throw new NotAWikiError('Diese Datei ist keine MindWiki-Datenbank.')
    }
    if (version > MIGRATIONS.length) {
      throw new NotAWikiError('Diese Datenbank stammt aus einer neueren MindWiki-Version.')
    }

    // Vor einem Update der Struktur eine Kopie des alten Stands ablegen.
    if (version > 0 && version < MIGRATIONS.length && file !== ':memory:') {
      const base = path.basename(file, path.extname(file))
      backupTo(db, path.join(path.dirname(file), 'Sicherungen', `${base}_vor-Update-v${version}.db`))
    }

    for (let v = version; v < MIGRATIONS.length; v++) {
      db.exec('BEGIN')
      try {
        db.exec(MIGRATIONS[v])
        db.exec(`PRAGMA user_version = ${v + 1}`)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    }

    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('app', ?)").run(APP_MARKER)
    const root = db.prepare('SELECT id FROM articles WHERE parent_id IS NULL').get()
    if (!root) db.prepare('INSERT INTO articles (parent_id, title) VALUES (NULL, ?)').run(rootTitle)
    return db
  } catch (err) {
    db.close()
    throw err
  }
}

/** Konsistente Kopie der Datenbank (auch während sie geöffnet ist). */
export function backupTo(db: DatabaseSync, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (fs.existsSync(target)) fs.rmSync(target)
  db.prepare('VACUUM INTO ?').run(target)
}

function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/**
 * Höchstens eine automatische Sicherung pro Tag in `<DB-Ordner>/Sicherungen`,
 * die neuesten `keep` bleiben erhalten.
 */
export function autoBackup(db: DatabaseSync, dbFile: string, keep = 5): string | null {
  const dir = path.join(path.dirname(dbFile), 'Sicherungen')
  const base = path.basename(dbFile, path.extname(dbFile))
  const prefix = `${base}_`
  const today = stamp().slice(0, 10)
  // nur datierte Tagessicherungen rotieren, keine manuellen oder „vor-Update“-Kopien
  const dated = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$/
  const existing = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.startsWith(prefix) && dated.test(f.slice(prefix.length)))
        .sort()
    : []
  if (existing.some((f) => f.slice(prefix.length, prefix.length + 10) === today)) return null

  const target = path.join(dir, `${prefix}${stamp()}.db`)
  backupTo(db, target)
  const all = [...existing, path.basename(target)].sort()
  for (const old of all.slice(0, Math.max(0, all.length - keep))) {
    fs.rmSync(path.join(dir, old), { force: true })
  }
  return target
}
