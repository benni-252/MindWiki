import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { findTemplate, SECRET_LABEL, templateDoc, type ArticleTemplate } from '../shared/templates'
import {
  IMAGE_URL_PATTERN,
  imageUrl,
  type Article,
  type ArticleField,
  type ArticleSummary,
  type ChangeEntry,
  type ChangeKind,
  type Checklist,
  type ChecklistItem,
  type ChecklistRun,
  type DependencyEdge,
  type LinkEdge,
  type RecentChange,
  type RunSnapshotItem,
  type SaveResult,
  type SearchHit,
  type TrashEntry,
  type TreeData
} from '../shared/types'
import { docText, extractArticleLinks } from './links'

type Row = Record<string, unknown>

export class WikiError extends Error {}

const UNTITLED = 'Ohne Titel'

/** Textänderungen derselben Person innerhalb dieser Zeit ergeben einen Verlaufseintrag. */
export const TEXT_MERGE_MS = 15 * 60_000
/** Umbenennen so kurz nach dem Anlegen gehört noch zum Anlegen. */
export const NAMING_AFTER_CREATE_MS = 5 * 60_000
/** So viele frühere Textfassungen bleiben je Artikel gespeichert. */
export const KEEP_TEXT_VERSIONS = 30

/** Zitat für Verlaufseinträge, lange Werte gekürzt. */
function q(value: string, max = 60): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return `„${clean.length > max ? `${clean.slice(0, max - 1)}…` : clean}“`
}

function formatStamp(iso: string): string {
  const d = new Date(iso)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Alle Lese- und Schreibzugriffe auf eine geöffnete Wiki-Datenbank. */
export class WikiStore {
  /** > 0: Änderungen nicht protokollieren (z. B. Bestandteile einer Vorlage) */
  private quiet = 0
  private txDepth = 0

  /** `author`: Name, unter dem Änderungen im Verlauf erscheinen */
  constructor(
    readonly db: DatabaseSync,
    public author = 'Unbekannt'
  ) {}

  // ---------- Hilfsfunktionen ----------

  private all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[]
  }

  private get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined
  }

  private run(sql: string, ...params: SQLInputValue[]): number {
    return Number(this.db.prepare(sql).run(...params).lastInsertRowid)
  }

  /** Schreibtransaktion; IMMEDIATE sperrt sofort, damit sich zwei Rechner nicht gegenseitig blockieren. */
  private tx<T>(fn: () => T): T {
    // verschachtelt (z. B. Vorlage innerhalb von createArticle): in der äußeren Transaktion mitlaufen
    if (this.txDepth > 0) return fn()
    this.db.exec('BEGIN IMMEDIATE')
    this.txDepth++
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    } finally {
      this.txDepth--
    }
  }

  private now(): string {
    return new Date().toISOString()
  }

  /**
   * Tauscht ein Element mit seinem Nachbarn innerhalb seiner Gruppe.
   * Tabellen- und Spaltennamen stammen nur aus diesem Modul.
   */
  private swap(table: string, groupCol: string, id: number, direction: -1 | 1, extraWhere = ''): void {
    const self = this.get<{ g: number }>(`SELECT ${groupCol} AS g FROM ${table} WHERE id = ?`, id)
    if (!self) return
    const ids = this.all<{ id: number }>(
      `SELECT id FROM ${table} WHERE ${groupCol} = ? ${extraWhere} ORDER BY position, id`,
      self.g
    ).map((r) => r.id)
    const index = ids.indexOf(id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    this.tx(() => {
      const update = this.db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`)
      ids.forEach((rowId, pos) => update.run(pos, rowId))
    })
  }

  private nextPosition(table: string, groupCol: string, groupId: number): number {
    const row = this.get<{ p: number }>(
      `SELECT COALESCE(MAX(position), -1) + 1 AS p FROM ${table} WHERE ${groupCol} = ?`,
      groupId
    )
    return row?.p ?? 0
  }

  private requireLiveArticle(id: number): { id: number; parent_id: number | null } {
    const row = this.get<{ id: number; parent_id: number | null }>(
      'SELECT id, parent_id FROM articles WHERE id = ? AND deleted_at IS NULL',
      id
    )
    if (!row) throw new WikiError('Artikel nicht gefunden.')
    return row
  }

  private log(articleId: number, kind: ChangeKind, summary: string, oldContent: string | null = null): void {
    if (this.quiet > 0) return
    this.run(
      'INSERT INTO changes (article_id, at, author, kind, summary, old_content) VALUES (?, ?, ?, ?, ?, ?)',
      articleId,
      this.now(),
      this.author,
      kind,
      summary,
      oldContent
    )
  }

  private silently<T>(fn: () => T): T {
    this.quiet++
    try {
      return fn()
    } finally {
      this.quiet--
    }
  }

  private titleOf(id: number): string {
    return this.get<{ title: string }>('SELECT title FROM articles WHERE id = ?', id)?.title ?? '?'
  }

  /** Zähler, der sich ändert, sobald eine andere Verbindung (anderer Rechner) etwas gespeichert hat. */
  dataVersion(): number {
    return (this.get<{ data_version: number }>('PRAGMA data_version')?.data_version ?? 0) as number
  }

  rootId(): number {
    const row = this.get<{ id: number }>('SELECT id FROM articles WHERE parent_id IS NULL')
    if (!row) throw new WikiError('Wurzelartikel fehlt.')
    return row.id
  }

  // ---------- Artikel ----------

  getTree(): TreeData {
    const articles = this.all<Row>(
      `SELECT a.id, a.parent_id, a.title, a.position, a.color, a.icon, a.collapsed,
              a.outage_since, a.outage_note,
              a.content_text <> '' AS has_text,
              COALESCE(c.total, 0) AS total, COALESCE(c.done, 0) AS done,
              lc.at AS last_at, lc.author AS last_by, oc.at AS other_at, oc.author AS other_by
         FROM articles a
         LEFT JOIN (SELECT article_id, MAX(at) AS at, author FROM changes GROUP BY article_id) lc
           ON lc.article_id = a.id
         LEFT JOIN (SELECT article_id, MAX(at) AS at, author FROM changes WHERE author <> ? GROUP BY article_id) oc
           ON oc.article_id = a.id
         LEFT JOIN (
           SELECT cl.article_id, COUNT(i.id) AS total, SUM(i.checked) AS done
             FROM checklists cl JOIN checklist_items i ON i.checklist_id = cl.id
            GROUP BY cl.article_id
         ) c ON c.article_id = a.id
        WHERE a.deleted_at IS NULL
        ORDER BY a.position, a.id`,
      this.author
    ).map(
      (r): ArticleSummary => ({
        id: r.id as number,
        parentId: (r.parent_id as number | null) ?? null,
        title: r.title as string,
        position: r.position as number,
        color: (r.color as string | null) ?? null,
        icon: (r.icon as string | null) ?? null,
        collapsed: r.collapsed === 1,
        hasText: r.has_text === 1,
        checkTotal: r.total as number,
        checkDone: r.done as number,
        outageSince: (r.outage_since as string | null) ?? null,
        outageNote: (r.outage_note as string | null) ?? null,
        lastChangeAt: (r.last_at as string | null) ?? null,
        lastChangeBy: (r.last_by as string | null) ?? null,
        lastOtherChangeAt: (r.other_at as string | null) ?? null,
        lastOtherChangeBy: (r.other_by as string | null) ?? null
      })
    )
    const links = this.all<Row>(
      `SELECT l.from_id, l.to_id FROM links l
         JOIN articles f ON f.id = l.from_id
         JOIN articles t ON t.id = l.to_id
        WHERE f.deleted_at IS NULL AND t.deleted_at IS NULL`
    ).map((r): LinkEdge => ({ fromId: r.from_id as number, toId: r.to_id as number }))
    const dependencies = this.all<Row>(
      `SELECT d.article_id, d.depends_on_id FROM dependencies d
         JOIN articles a ON a.id = d.article_id
         JOIN articles b ON b.id = d.depends_on_id
        WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL`
    ).map((r): DependencyEdge => ({ articleId: r.article_id as number, dependsOnId: r.depends_on_id as number }))
    return { rootId: this.rootId(), articles, links, dependencies }
  }

  getArticle(id: number): Article | null {
    const r = this.get<Row>('SELECT * FROM articles WHERE id = ? AND deleted_at IS NULL', id)
    if (!r) return null
    return {
      id: r.id as number,
      parentId: (r.parent_id as number | null) ?? null,
      title: r.title as string,
      content: (r.content as string | null) ?? null,
      color: (r.color as string | null) ?? null,
      collapsed: r.collapsed === 1,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string
    }
  }

  /** Legt einen Unterartikel an – ans Ende oder direkt hinter `afterId`, optional aus einer Vorlage. */
  createArticle(parentId: number, title: string, afterId: number | null = null, templateId: string | null = null): number {
    this.requireLiveArticle(parentId)
    const template = templateId ? this.requireTemplate(templateId) : null
    const clean = title.trim() || UNTITLED
    return this.tx(() => {
      let position: number
      const after =
        afterId == null
          ? undefined
          : this.get<{ position: number }>(
              'SELECT position FROM articles WHERE id = ? AND parent_id = ?',
              afterId,
              parentId
            )
      if (after) {
        position = after.position + 1
        this.run('UPDATE articles SET position = position + 1 WHERE parent_id = ? AND position >= ?', parentId, position)
      } else {
        position = this.nextPosition('articles', 'parent_id', parentId)
      }
      this.run('UPDATE articles SET collapsed = 0 WHERE id = ?', parentId)
      const id = this.run('INSERT INTO articles (parent_id, title, position) VALUES (?, ?, ?)', parentId, clean, position)
      if (template) this.silently(() => this.fillFromTemplate(id, template))
      this.log(id, 'create', template ? `Angelegt aus der Vorlage ${q(template.name)}` : 'Angelegt')
      return id
    })
  }

  private requireTemplate(templateId: string): ArticleTemplate {
    const template = findTemplate(templateId)
    if (!template) throw new WikiError('Unbekannte Vorlage.')
    return template
  }

  /**
   * Ergänzt einen Artikel um die Bestandteile einer Vorlage, ohne Vorhandenes zu überschreiben:
   * Text nur wenn leer, Symbol nur wenn keins gesetzt, nur fehlende Felder, Abläufe zusätzlich.
   */
  applyTemplate(id: number, templateId: string): void {
    this.requireLiveArticle(id)
    const template = this.requireTemplate(templateId)
    this.tx(() => {
      this.silently(() => this.fillFromTemplate(id, template))
      this.log(id, 'template', `Vorlage ${q(template.name)} angewendet`)
    })
  }

  private fillFromTemplate(id: number, template: ArticleTemplate): void {
    const article = this.get<{ content: string | null; content_text: string; icon: string | null }>(
      'SELECT content, content_text, icon FROM articles WHERE id = ?',
      id
    )
    if (!article) return
    const emptyText = article.content_text.trim() === '' && !article.content?.includes('wikiimg://')
    if (emptyText && template.sections.length > 0) {
      this.run(
        'UPDATE articles SET content = ?, content_text = ? WHERE id = ?',
        templateDoc(template),
        template.sections.join('\n'),
        id
      )
    }
    if (!article.icon) this.run('UPDATE articles SET icon = ? WHERE id = ?', template.icon, id)

    const existing = new Set(
      this.all<{ label: string }>('SELECT label FROM article_fields WHERE article_id = ?', id).map((f) =>
        f.label.toLocaleLowerCase('de')
      )
    )
    for (const label of template.fields) {
      if (!existing.has(label.toLocaleLowerCase('de'))) this.addField(id, label)
    }
    for (const list of template.checklists) {
      const listId = this.createChecklist(id, list.title)
      for (const step of list.steps) this.addItem(listId, step)
    }
  }

  /** Speichert auch Artikel im Papierkorb, damit eine letzte Änderung beim Löschen nicht verloren geht. */
  saveArticleContent(id: number, content: string, text: string): SaveResult {
    return this.writeContent(id, content, text, null)
  }

  /**
   * Schreibt den Text und protokolliert die Änderung samt der Fassung davor. Mehrere Speicherungen
   * derselben Person kurz hintereinander werden zu einem Verlaufseintrag zusammengefasst –
   * außer `summary` ist gesetzt (z. B. beim Wiederherstellen), dann gibt es immer einen eigenen Eintrag.
   */
  private writeContent(id: number, content: string, text: string, summary: string | null): SaveResult {
    const before = this.get<{ has_text: number; content: string | null }>(
      "SELECT content_text <> '' AS has_text, content FROM articles WHERE id = ?",
      id
    )
    if (!before) throw new WikiError('Artikel nicht gefunden.')
    if (before.content === content) return { treeChanged: false }
    const plain = text.trim()

    return this.tx(() => {
      this.logText(id, before.content, summary)
      this.run(
        'UPDATE articles SET content = ?, content_text = ?, updated_at = ? WHERE id = ?',
        content,
        plain,
        this.now(),
        id
      )
      const wanted = extractArticleLinks(content).filter(
        (to) => to !== id && this.get('SELECT 1 FROM articles WHERE id = ?', to) !== undefined
      )
      const current = this.all<{ to_id: number }>('SELECT to_id FROM links WHERE from_id = ?', id).map((r) => r.to_id)
      const same = wanted.length === current.length && wanted.every((to) => current.includes(to))
      if (!same) {
        this.run('DELETE FROM links WHERE from_id = ?', id)
        const insert = this.db.prepare('INSERT INTO links (from_id, to_id) VALUES (?, ?)')
        for (const to of wanted) insert.run(id, to)
      }
      return { treeChanged: !same || (before.has_text === 1) !== (plain !== '') }
    })
  }

  private logText(id: number, oldContent: string | null, summary: string | null): void {
    const last = this.get<{ id: number; kind: string; author: string; at: string }>(
      'SELECT id, kind, author, at FROM changes WHERE article_id = ? ORDER BY at DESC, id DESC LIMIT 1',
      id
    )
    const sameSession =
      !summary &&
      last?.kind === 'text' &&
      last.author === this.author &&
      Date.now() - Date.parse(last.at) < TEXT_MERGE_MS
    if (sameSession) {
      this.run('UPDATE changes SET at = ? WHERE id = ?', this.now(), last.id)
      return
    }
    this.log(id, 'text', summary ?? 'Text bearbeitet', oldContent)
    this.run(
      `UPDATE changes SET old_content = NULL
        WHERE article_id = ? AND old_content IS NOT NULL AND id NOT IN (
          SELECT id FROM changes WHERE article_id = ? AND old_content IS NOT NULL
           ORDER BY at DESC, id DESC LIMIT ${KEEP_TEXT_VERSIONS}
        )`,
      id,
      id
    )
  }

  renameArticle(id: number, title: string): void {
    const clean = title.trim() || UNTITLED
    const old = this.titleOf(id)
    if (old === clean) return
    // Benennen direkt nach dem Anlegen ist Teil des Anlegens – kein eigener Verlaufseintrag
    const last = this.get<{ kind: string; author: string; at: string }>(
      'SELECT kind, author, at FROM changes WHERE article_id = ? ORDER BY at DESC, id DESC LIMIT 1',
      id
    )
    const justCreated =
      last?.kind === 'create' && last.author === this.author && Date.now() - Date.parse(last.at) < NAMING_AFTER_CREATE_MS
    this.tx(() => {
      this.run('UPDATE articles SET title = ?, updated_at = ? WHERE id = ?', clean, this.now(), id)
      if (!justCreated) this.log(id, 'title', `Titel geändert: ${q(old)} → ${q(clean)}`)
    })
  }

  setArticleColor(id: number, color: string | null): void {
    this.run('UPDATE articles SET color = ? WHERE id = ?', color, id)
  }

  setArticleIcon(id: number, icon: string | null): void {
    const old = this.get<{ icon: string | null }>('SELECT icon FROM articles WHERE id = ?', id)
    if (!old || old.icon === icon) return
    this.tx(() => {
      this.run('UPDATE articles SET icon = ? WHERE id = ?', icon, id)
      this.log(id, 'icon', icon ? 'Symbol geändert' : 'Symbol entfernt')
    })
  }

  setCollapsed(id: number, collapsed: boolean): void {
    this.run('UPDATE articles SET collapsed = ? WHERE id = ?', collapsed ? 1 : 0, id)
  }

  /** true, wenn `candidate` gleich `ancestor` ist oder darunter hängt. */
  isInSubtree(candidate: number, ancestor: number): boolean {
    let current: number | null = candidate
    const seen = new Set<number>()
    while (current != null && !seen.has(current)) {
      if (current === ancestor) return true
      seen.add(current)
      current = this.get<{ parent_id: number | null }>('SELECT parent_id FROM articles WHERE id = ?', current)?.parent_id ?? null
    }
    return false
  }

  moveArticle(id: number, newParentId: number): void {
    const article = this.requireLiveArticle(id)
    this.requireLiveArticle(newParentId)
    if (article.parent_id == null) throw new WikiError('Die Wurzel kann nicht verschoben werden.')
    if (this.isInSubtree(newParentId, id)) {
      throw new WikiError('Ein Artikel kann nicht unter sich selbst verschoben werden.')
    }
    if (article.parent_id === newParentId) return
    this.tx(() => {
      this.run(
        'UPDATE articles SET parent_id = ?, position = ? WHERE id = ?',
        newParentId,
        this.nextPosition('articles', 'parent_id', newParentId),
        id
      )
      this.run('UPDATE articles SET collapsed = 0 WHERE id = ?', newParentId)
      this.log(id, 'move', `Verschoben unter ${q(this.titleOf(newParentId))}`)
    })
  }

  reorderArticle(id: number, direction: -1 | 1): void {
    this.swap('articles', 'parent_id', id, direction, 'AND deleted_at IS NULL')
  }

  /** Verschiebt den ganzen Ast in den Papierkorb. */
  deleteArticle(id: number): void {
    const article = this.requireLiveArticle(id)
    if (article.parent_id == null) throw new WikiError('Die Wurzel kann nicht gelöscht werden.')
    this.tx(() => {
      this.run(
        `WITH RECURSIVE sub(id) AS (
           SELECT ? UNION ALL
           SELECT a.id FROM articles a JOIN sub ON a.parent_id = sub.id WHERE a.deleted_at IS NULL
         )
         UPDATE articles SET deleted_at = ? WHERE id IN (SELECT id FROM sub) AND deleted_at IS NULL`,
        id,
        this.now()
      )
      this.log(id, 'trash', 'In den Papierkorb verschoben')
    })
  }

  search(query: string): SearchHit[] {
    const tokens = query.toLocaleLowerCase('de').split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return []
    const checks = new Map<number, string>()
    for (const r of this.all<{ article_id: number; t: string }>(
      `SELECT cl.article_id, cl.title || ' ' || COALESCE(group_concat(i.text, ' · '), '') AS t
         FROM checklists cl LEFT JOIN checklist_items i ON i.checklist_id = cl.id
        GROUP BY cl.id`
    )) {
      checks.set(r.article_id, `${checks.get(r.article_id) ?? ''} ${r.t}`)
    }

    const fields = new Map<number, string>()
    for (const r of this.all<{ article_id: number; t: string }>(
      `SELECT article_id, group_concat(label || ': ' || value, ' · ') AS t
         FROM (SELECT * FROM article_fields WHERE value <> '' ORDER BY position, id)
        GROUP BY article_id`
    )) {
      fields.set(r.article_id, r.t)
    }

    const hits: (SearchHit & { score: number })[] = []
    for (const r of this.all<{ id: number; title: string; content_text: string }>(
      'SELECT id, title, content_text FROM articles WHERE deleted_at IS NULL'
    )) {
      const title = r.title.toLocaleLowerCase('de')
      const body = [fields.get(r.id), r.content_text, checks.get(r.id)].filter(Boolean).join(' · ')
      const haystack = `${title} ${body.toLocaleLowerCase('de')}`
      if (!tokens.every((t) => haystack.includes(t))) continue

      let score = 1
      if (title.startsWith(tokens[0])) score = 4
      else if (tokens.every((t) => title.includes(t))) score = 3
      else if (tokens.some((t) => title.includes(t))) score = 2
      hits.push({ id: r.id, title: r.title, snippet: makeSnippet(body, tokens), score })
    }
    hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'de'))
    return hits.slice(0, 30).map(({ score: _score, ...hit }) => hit)
  }

  // ---------- Abhängigkeiten & Störungen ----------

  addDependency(articleId: number, dependsOnId: number): void {
    if (articleId === dependsOnId) throw new WikiError('Ein Artikel kann nicht von sich selbst abhängen.')
    this.requireLiveArticle(articleId)
    this.requireLiveArticle(dependsOnId)
    this.tx(() => {
      const added = this.db
        .prepare('INSERT OR IGNORE INTO dependencies (article_id, depends_on_id) VALUES (?, ?)')
        .run(articleId, dependsOnId).changes
      if (Number(added) === 0) return
      this.log(articleId, 'dependency', `Abhängigkeit hinzugefügt: hängt ab von ${q(this.titleOf(dependsOnId))}`)
      this.log(dependsOnId, 'dependency', `Abhängigkeit hinzugefügt: ${q(this.titleOf(articleId))} hängt hiervon ab`)
    })
  }

  removeDependency(articleId: number, dependsOnId: number): void {
    this.tx(() => {
      const removed = this.db
        .prepare('DELETE FROM dependencies WHERE article_id = ? AND depends_on_id = ?')
        .run(articleId, dependsOnId).changes
      if (Number(removed) === 0) return
      this.log(articleId, 'dependency', `Abhängigkeit entfernt: hängt nicht mehr ab von ${q(this.titleOf(dependsOnId))}`)
      this.log(dependsOnId, 'dependency', `Abhängigkeit entfernt: ${q(this.titleOf(articleId))} hängt nicht mehr hiervon ab`)
    })
  }

  reportOutage(id: number, note: string | null): void {
    this.requireLiveArticle(id)
    const before = this.get<{ outage_since: string | null; outage_note: string | null }>(
      'SELECT outage_since, outage_note FROM articles WHERE id = ?',
      id
    )
    const clean = note?.trim() || null
    if (before?.outage_since && before.outage_note === clean) return
    this.tx(() => {
      this.run(
        'UPDATE articles SET outage_since = COALESCE(outage_since, ?), outage_note = ? WHERE id = ?',
        this.now(),
        clean,
        id
      )
      if (!before?.outage_since) this.log(id, 'outage', `Störung gemeldet${clean ? `: ${q(clean)}` : ''}`)
      else this.log(id, 'outage', clean ? `Störungsnotiz: ${q(clean)}` : 'Störungsnotiz entfernt')
    })
  }

  resolveOutage(id: number): void {
    const before = this.get<{ outage_since: string | null }>('SELECT outage_since FROM articles WHERE id = ?', id)
    if (!before?.outage_since) return
    this.tx(() => {
      this.run('UPDATE articles SET outage_since = NULL, outage_note = NULL WHERE id = ?', id)
      this.log(id, 'outage', 'Störung behoben')
    })
  }

  // ---------- Verlauf ----------

  private toChange(r: Row): ChangeEntry {
    return {
      id: r.id as number,
      articleId: r.article_id as number,
      at: r.at as string,
      author: r.author as string,
      kind: r.kind as ChangeKind,
      summary: r.summary as string,
      hasVersion: r.has_version === 1
    }
  }

  getChanges(articleId: number): ChangeEntry[] {
    return this.all<Row>(
      `SELECT id, article_id, at, author, kind, summary, old_content IS NOT NULL AS has_version
         FROM changes WHERE article_id = ? ORDER BY at DESC, id DESC LIMIT 500`,
      articleId
    ).map((r) => this.toChange(r))
  }

  getRecentChanges(limit: number): RecentChange[] {
    return this.all<Row>(
      `SELECT c.id, c.article_id, c.at, c.author, c.kind, c.summary, c.old_content IS NOT NULL AS has_version,
              a.title, a.deleted_at IS NOT NULL AS deleted
         FROM changes c JOIN articles a ON a.id = c.article_id
        ORDER BY c.at DESC, c.id DESC LIMIT ?`,
      Math.max(1, Math.min(2000, Math.floor(limit)))
    ).map((r) => ({ ...this.toChange(r), title: r.title as string, deleted: r.deleted === 1 }))
  }

  getTextVersion(changeId: number): string | null {
    return this.get<{ old_content: string | null }>('SELECT old_content FROM changes WHERE id = ?', changeId)?.old_content ?? null
  }

  /** Setzt den Text auf die Fassung vor einer Änderung zurück; der aktuelle Text bleibt im Verlauf. */
  restoreTextVersion(changeId: number): void {
    const change = this.get<{ article_id: number; at: string; author: string; old_content: string | null }>(
      'SELECT article_id, at, author, old_content FROM changes WHERE id = ?',
      changeId
    )
    if (!change?.old_content) throw new WikiError('Diese Fassung ist nicht mehr gespeichert.')
    this.requireLiveArticle(change.article_id)
    this.writeContent(
      change.article_id,
      change.old_content,
      docText(change.old_content),
      `Text auf die Fassung vor der Änderung von ${change.author} (${formatStamp(change.at)}) zurückgesetzt`
    )
  }

  // ---------- Papierkorb ----------

  listTrash(): TrashEntry[] {
    const roots = this.all<{ id: number; title: string; deleted_at: string }>(
      `SELECT a.id, a.title, a.deleted_at FROM articles a
         JOIN articles p ON p.id = a.parent_id
        WHERE a.deleted_at IS NOT NULL AND (p.deleted_at IS NULL OR p.deleted_at <> a.deleted_at)
        ORDER BY a.deleted_at DESC`
    )
    return roots.map((r) => ({
      id: r.id,
      title: r.title,
      deletedAt: r.deleted_at,
      count:
        this.get<{ n: number }>(
          `WITH RECURSIVE sub(id) AS (
             SELECT ? UNION ALL
             SELECT a.id FROM articles a JOIN sub ON a.parent_id = sub.id WHERE a.deleted_at = ?
           ) SELECT COUNT(*) AS n FROM sub`,
          r.id,
          r.deleted_at
        )?.n ?? 1
    }))
  }

  restoreArticle(id: number): void {
    const row = this.get<{ deleted_at: string | null; parent_id: number }>(
      'SELECT deleted_at, parent_id FROM articles WHERE id = ?',
      id
    )
    if (!row?.deleted_at) return
    this.tx(() => {
      this.run(
        `WITH RECURSIVE sub(id) AS (
           SELECT ? UNION ALL
           SELECT a.id FROM articles a JOIN sub ON a.parent_id = sub.id WHERE a.deleted_at = ?
         )
         UPDATE articles SET deleted_at = NULL WHERE id IN (SELECT id FROM sub)`,
        id,
        row.deleted_at
      )
      // Liegt der Elternartikel selbst im Papierkorb, landet der Ast direkt unter der Wurzel.
      const parentDeleted = this.get('SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NOT NULL', row.parent_id)
      if (parentDeleted) {
        const root = this.rootId()
        this.run(
          'UPDATE articles SET parent_id = ?, position = ? WHERE id = ?',
          root,
          this.nextPosition('articles', 'parent_id', root),
          id
        )
      }
      this.log(id, 'trash', 'Aus dem Papierkorb wiederhergestellt')
    })
  }

  purgeArticle(id: number): void {
    this.run('DELETE FROM articles WHERE id = ? AND deleted_at IS NOT NULL', id)
    this.cleanupImages(10)
  }

  emptyTrash(): void {
    this.run('DELETE FROM articles WHERE deleted_at IS NOT NULL')
    this.cleanupImages(10)
  }

  /** Entfernt Bilder, die in keinem Artikel (auch nicht im Papierkorb) mehr vorkommen. */
  cleanupImages(minAgeMinutes = 0): number {
    const used = new Set<number>()
    for (const r of this.all<{ content: string }>(
      `SELECT content FROM articles WHERE content IS NOT NULL
       UNION ALL SELECT old_content FROM changes WHERE old_content IS NOT NULL`
    )) {
      for (const m of r.content.matchAll(IMAGE_URL_PATTERN)) used.add(Number(m[1]))
    }
    const cutoff = new Date(Date.now() - minAgeMinutes * 60_000).toISOString()
    const candidates = this.all<{ id: number }>('SELECT id FROM images WHERE created_at <= ?', cutoff)
    const remove = this.db.prepare('DELETE FROM images WHERE id = ?')
    let removed = 0
    for (const { id } of candidates) {
      if (!used.has(id)) removed += Number(remove.run(id).changes)
    }
    return removed
  }

  // ---------- Steckbrief-Felder ----------

  getFields(articleId: number): ArticleField[] {
    return this.all<Row>(
      'SELECT id, article_id, label, value, position FROM article_fields WHERE article_id = ? ORDER BY position, id',
      articleId
    ).map((r) => ({
      id: r.id as number,
      articleId: r.article_id as number,
      label: r.label as string,
      value: r.value as string,
      position: r.position as number
    }))
  }

  addField(articleId: number, label: string, value = ''): number {
    const cleanLabel = label.trim() || 'Feld'
    const cleanValue = value.trim()
    return this.tx(() => {
      const id = this.run(
        'INSERT INTO article_fields (article_id, label, value, position) VALUES (?, ?, ?, ?)',
        articleId,
        cleanLabel,
        cleanValue,
        this.nextPosition('article_fields', 'article_id', articleId)
      )
      const shown = cleanValue && !SECRET_LABEL.test(cleanLabel) ? `: ${q(cleanValue)}` : ''
      this.log(articleId, 'field', `Feld ${q(cleanLabel)} hinzugefügt${shown}`)
      return id
    })
  }

  updateField(id: number, label: string, value: string): void {
    const old = this.get<{ article_id: number; label: string; value: string }>(
      'SELECT article_id, label, value FROM article_fields WHERE id = ?',
      id
    )
    const cleanLabel = label.trim() || 'Feld'
    const cleanValue = value.trim()
    if (!old || (old.label === cleanLabel && old.value === cleanValue)) return
    const parts: string[] = []
    if (old.label !== cleanLabel) parts.push(`Feld ${q(old.label)} umbenannt in ${q(cleanLabel)}`)
    if (old.value !== cleanValue) {
      // Werte von Passwort-Feldern o. Ä. nicht in den Verlauf schreiben
      if (SECRET_LABEL.test(cleanLabel) || SECRET_LABEL.test(old.label)) parts.push(`${cleanLabel}: Wert geändert`)
      else if (!old.value) parts.push(`${cleanLabel}: ${q(cleanValue)} eingetragen`)
      else if (!cleanValue) parts.push(`${cleanLabel}: ${q(old.value)} entfernt`)
      else parts.push(`${cleanLabel}: ${q(old.value)} → ${q(cleanValue)}`)
    }
    this.tx(() => {
      this.run('UPDATE article_fields SET label = ?, value = ? WHERE id = ?', cleanLabel, cleanValue, id)
      this.log(old.article_id, 'field', parts.join('; '))
    })
  }

  deleteField(id: number): void {
    const old = this.get<{ article_id: number; label: string; value: string }>(
      'SELECT article_id, label, value FROM article_fields WHERE id = ?',
      id
    )
    if (!old) return
    this.tx(() => {
      this.run('DELETE FROM article_fields WHERE id = ?', id)
      const shown = old.value && !SECRET_LABEL.test(old.label) ? ` (war ${q(old.value)})` : ''
      this.log(old.article_id, 'field', `Feld ${q(old.label)} entfernt${shown}`)
    })
  }

  moveField(id: number, direction: -1 | 1): void {
    this.swap('article_fields', 'article_id', id, direction)
  }

  // ---------- Abläufe / Checklisten ----------

  getChecklists(articleId: number): Checklist[] {
    const lists = this.all<Row>(
      'SELECT id, article_id, title, position FROM checklists WHERE article_id = ? ORDER BY position, id',
      articleId
    )
    const items = this.all<Row>(
      `SELECT i.* FROM checklist_items i JOIN checklists c ON c.id = i.checklist_id
        WHERE c.article_id = ? ORDER BY i.position, i.id`,
      articleId
    ).map(
      (r): ChecklistItem => ({
        id: r.id as number,
        checklistId: r.checklist_id as number,
        text: r.text as string,
        position: r.position as number,
        checked: r.checked === 1,
        checkedAt: (r.checked_at as string | null) ?? null
      })
    )
    return lists.map((l) => ({
      id: l.id as number,
      articleId: l.article_id as number,
      title: l.title as string,
      position: l.position as number,
      items: items.filter((i) => i.checklistId === l.id)
    }))
  }

  private checklistInfo(id: number): { article_id: number; title: string } | undefined {
    return this.get<{ article_id: number; title: string }>('SELECT article_id, title FROM checklists WHERE id = ?', id)
  }

  createChecklist(articleId: number, title: string): number {
    this.requireLiveArticle(articleId)
    const clean = title.trim() || 'Ablauf'
    return this.tx(() => {
      const id = this.run(
        'INSERT INTO checklists (article_id, title, position) VALUES (?, ?, ?)',
        articleId,
        clean,
        this.nextPosition('checklists', 'article_id', articleId)
      )
      this.log(articleId, 'checklist', `Ablauf ${q(clean)} angelegt`)
      return id
    })
  }

  renameChecklist(id: number, title: string): void {
    const clean = title.trim() || 'Ablauf'
    const list = this.checklistInfo(id)
    if (!list || list.title === clean) return
    this.tx(() => {
      this.run('UPDATE checklists SET title = ? WHERE id = ?', clean, id)
      this.log(list.article_id, 'checklist', `Ablauf ${q(list.title)} umbenannt in ${q(clean)}`)
    })
  }

  deleteChecklist(id: number): void {
    const list = this.checklistInfo(id)
    if (!list) return
    this.tx(() => {
      this.run('DELETE FROM checklists WHERE id = ?', id)
      this.log(list.article_id, 'checklist', `Ablauf ${q(list.title)} gelöscht`)
    })
  }

  moveChecklist(id: number, direction: -1 | 1): void {
    this.swap('checklists', 'article_id', id, direction)
  }

  addItem(checklistId: number, text: string): number {
    const clean = text.trim()
    const list = this.checklistInfo(checklistId)
    return this.tx(() => {
      const id = this.run(
        'INSERT INTO checklist_items (checklist_id, text, position) VALUES (?, ?, ?)',
        checklistId,
        clean,
        this.nextPosition('checklist_items', 'checklist_id', checklistId)
      )
      if (list) this.log(list.article_id, 'checklist', `Schritt ${q(clean)} zu ${q(list.title)} hinzugefügt`)
      return id
    })
  }

  private itemInfo(id: number): { text: string; article_id: number; title: string } | undefined {
    return this.get<{ text: string; article_id: number; title: string }>(
      `SELECT i.text, c.article_id, c.title FROM checklist_items i JOIN checklists c ON c.id = i.checklist_id
        WHERE i.id = ?`,
      id
    )
  }

  updateItemText(id: number, text: string): void {
    const clean = text.trim()
    const item = this.itemInfo(id)
    if (!item || item.text === clean) return
    this.tx(() => {
      this.run('UPDATE checklist_items SET text = ? WHERE id = ?', clean, id)
      this.log(item.article_id, 'checklist', `Schritt in ${q(item.title)} geändert: ${q(item.text)} → ${q(clean)}`)
    })
  }

  setItemChecked(id: number, checked: boolean): void {
    this.run(
      'UPDATE checklist_items SET checked = ?, checked_at = ? WHERE id = ?',
      checked ? 1 : 0,
      checked ? this.now() : null,
      id
    )
  }

  deleteItem(id: number): void {
    const item = this.itemInfo(id)
    if (!item) return
    this.tx(() => {
      this.run('DELETE FROM checklist_items WHERE id = ?', id)
      this.log(item.article_id, 'checklist', `Schritt ${q(item.text)} aus ${q(item.title)} entfernt`)
    })
  }

  moveItem(id: number, direction: -1 | 1): void {
    this.swap('checklist_items', 'checklist_id', id, direction)
  }

  resetChecklist(id: number): void {
    this.run('UPDATE checklist_items SET checked = 0, checked_at = NULL WHERE checklist_id = ?', id)
  }

  /** Protokolliert den aktuellen Stand als Durchlauf und setzt die Haken zurück. */
  completeRun(checklistId: number, note: string | null): void {
    const snapshot: RunSnapshotItem[] = this.all<{ text: string; checked: number }>(
      'SELECT text, checked FROM checklist_items WHERE checklist_id = ? ORDER BY position, id',
      checklistId
    ).map((r) => ({ text: r.text, checked: r.checked === 1 }))
    this.tx(() => {
      this.run(
        'INSERT INTO checklist_runs (checklist_id, completed_at, note, snapshot) VALUES (?, ?, ?, ?)',
        checklistId,
        this.now(),
        note?.trim() || null,
        JSON.stringify(snapshot)
      )
      this.resetChecklist(checklistId)
      const list = this.checklistInfo(checklistId)
      const done = snapshot.filter((i) => i.checked).length
      if (list) {
        this.log(list.article_id, 'checklist', `Ablauf ${q(list.title)} durchgeführt (${done}/${snapshot.length} Schritte)`)
      }
    })
  }

  getRuns(checklistId: number): ChecklistRun[] {
    return this.all<Row>(
      'SELECT * FROM checklist_runs WHERE checklist_id = ? ORDER BY completed_at DESC, id DESC',
      checklistId
    ).map((r) => ({
      id: r.id as number,
      checklistId: r.checklist_id as number,
      completedAt: r.completed_at as string,
      note: (r.note as string | null) ?? null,
      snapshot: JSON.parse(r.snapshot as string) as RunSnapshotItem[]
    }))
  }

  deleteRun(id: number): void {
    const run = this.get<{ article_id: number; title: string; completed_at: string }>(
      `SELECT c.article_id, c.title, r.completed_at FROM checklist_runs r JOIN checklists c ON c.id = r.checklist_id
        WHERE r.id = ?`,
      id
    )
    if (!run) return
    this.tx(() => {
      this.run('DELETE FROM checklist_runs WHERE id = ?', id)
      this.log(run.article_id, 'checklist', `Protokoll von ${q(run.title)} vom ${formatStamp(run.completed_at)} gelöscht`)
    })
  }

  // ---------- Bilder ----------

  saveImage(mime: string, data: Uint8Array): string {
    if (!/^image\/[\w.+-]+$/.test(mime)) throw new WikiError('Nur Bilder können eingefügt werden.')
    return imageUrl(this.run('INSERT INTO images (mime, data, created_at) VALUES (?, ?, ?)', mime, data, this.now()))
  }

  getImage(id: number): { mime: string; data: Uint8Array } | undefined {
    return this.get<{ mime: string; data: Uint8Array }>('SELECT mime, data FROM images WHERE id = ?', id)
  }
}

function makeSnippet(body: string, tokens: string[]): string {
  if (!body) return ''
  const lower = body.toLocaleLowerCase('de')
  const index = Math.max(0, Math.min(...tokens.map((t) => lower.indexOf(t)).filter((i) => i >= 0), body.length))
  if (index >= body.length) return body.slice(0, 120)
  const start = Math.max(0, index - 40)
  const end = Math.min(body.length, index + 80)
  return `${start > 0 ? '…' : ''}${body.slice(start, end).replace(/\s+/g, ' ')}${end < body.length ? '…' : ''}`
}
