import { DatabaseSync } from 'node:sqlite'
import { DEFAULT_ADMIN, hashPassword } from './passwords'
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
  `,
  // v3: Abhängigkeiten zwischen Artikeln und Störungsstatus
  `
  ALTER TABLE articles ADD COLUMN outage_since TEXT;
  ALTER TABLE articles ADD COLUMN outage_note TEXT;
  CREATE TABLE dependencies (
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    depends_on_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    PRIMARY KEY (article_id, depends_on_id),
    CHECK (article_id <> depends_on_id)
  ) WITHOUT ROWID;
  CREATE INDEX idx_dependencies_on ON dependencies(depends_on_id);
  `,
  // v4: Verlauf – wer hat wann was geändert, bei Textänderungen mit der Fassung davor
  `
  CREATE TABLE changes (
    id INTEGER PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    author TEXT NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    old_content TEXT
  );
  CREATE INDEX idx_changes_article ON changes(article_id, at);
  CREATE INDEX idx_changes_at ON changes(at);
  `,
  // v5: Freigaben – neue Artikel und Änderungsvorschläge (Entwürfe als eigene, versteckte Artikel)
  `
  ALTER TABLE articles ADD COLUMN created_by TEXT;
  ALTER TABLE articles ADD COLUMN approved_at TEXT;
  ALTER TABLE articles ADD COLUMN approved_by TEXT;
  ALTER TABLE articles ADD COLUMN draft_of INTEGER REFERENCES articles(id) ON DELETE CASCADE;
  ALTER TABLE checklists ADD COLUMN source_id INTEGER;
  UPDATE articles SET approved_at = created_at;
  CREATE UNIQUE INDEX idx_articles_draft ON articles(draft_of) WHERE draft_of IS NOT NULL;
  INSERT OR IGNORE INTO meta (key, value) VALUES ('approval_required', '0');
  `,
  // v6: Benutzer mit Rollen (admin, editor = Bearbeiter, author = Mitarbeiter); gelöschte bleiben als Verweis
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'author')),
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${NOW}),
    deleted_at TEXT
  );
  `,
  // v7: Anhänge (Dokumente) an Artikeln. Der Inhalt liegt getrennt, damit Entwürfe ihn ohne Kopie teilen.
  `
  CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE TABLE attachments (
    id INTEGER PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    file_id INTEGER NOT NULL REFERENCES files(id),
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    added_by TEXT,
    added_at TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_attachments_article ON attachments(article_id, position);
  CREATE INDEX idx_attachments_file ON attachments(file_id);
  `
]

/**
 * Zusatztabellen ohne Versionssprung: Ältere MindWiki-Versionen kennen sie nicht, stören sich
 * aber auch nicht daran und können dieselbe Datei weiter öffnen. Nur für Daten, ohne die das
 * Wiki vollständig bleibt (z. B. die frei gezogene Anordnung der Mind Map).
 */
export const OPTIONAL_TABLES = `
  -- Frei verschobene Artikel: Versatz gegenüber der automatischen Anordnung (Unterartikel wandern mit)
  CREATE TABLE IF NOT EXISTS article_layout (
    article_id INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
    dx REAL NOT NULL,
    dy REAL NOT NULL
  );
`

export class NotAWikiError extends Error {}

/** Wartezeit bei gesperrter Datei; MINDWIKI_BUSY_TIMEOUT_MS verkürzt sie in automatischen Tests. */
export const BUSY_TIMEOUT_MS = Number(process.env.MINDWIKI_BUSY_TIMEOUT_MS) || 10_000

/**
 * Normales Rollback-Journal statt WAL: WAL funktioniert nicht, wenn mehrere Rechner dieselbe
 * Datei über ein Netzlaufwerk öffnen. Ältere Versionen haben WAL eingeschaltet – das wird hier
 * zurückgestellt, sobald niemand sonst die Datei offen hat.
 */
function useNetworkSafeJournal(db: DatabaseSync): void {
  try {
    db.exec('PRAGMA journal_mode = DELETE')
  } catch (err) {
    console.warn('Journal-Modus konnte nicht umgestellt werden', err)
  }
}

/**
 * Öffnet (oder erstellt) eine Wiki-Datenbank, spielt Migrationen ein und legt bei Bedarf
 * die Wurzel mit `rootTitle` an. Fremde SQLite-Dateien werden abgelehnt.
 */
export function openDatabase(file: string, rootTitle: string): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    // Mehrere Rechner können dieselbe Datei öffnen: kurz warten statt sofort „gesperrt“ melden.
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
    if (file !== ':memory:') useNetworkSafeJournal(db)

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
      db.exec('BEGIN IMMEDIATE')
      try {
        db.exec(MIGRATIONS[v])
        db.exec(`PRAGMA user_version = ${v + 1}`)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    }

    db.exec(OPTIONAL_TABLES)
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('app', ?)").run(APP_MARKER)
    // Jedes Wiki hat einen Admin; anfangs mit dem Passwort „admin“
    const users = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
    if (users.n === 0) {
      db.prepare("INSERT INTO users (username, role, password_hash) VALUES (?, 'admin', ?)").run(
        DEFAULT_ADMIN.username,
        hashPassword(DEFAULT_ADMIN.password)
      )
    }
    const root = db.prepare('SELECT id FROM articles WHERE parent_id IS NULL').get()
    if (!root) {
      db.prepare("INSERT INTO articles (parent_id, title, approved_at) VALUES (NULL, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run(
        rootTitle
      )
    }
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
