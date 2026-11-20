import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import {
  DEFAULT_BUCKET,
  isDateString,
  isLabelColor,
  isTaskPreview,
  isTaskPriority,
  isTaskProgress,
  TASK_LIMITS
} from '../shared/tasks'
import type {
  NewTaskOptions,
  Task,
  TaskBoard,
  TaskCheckItem,
  TaskComment,
  TaskPatch,
  TaskPreview,
  TaskPriority,
  TaskProgress,
  TaskRpc
} from '../shared/types'
import { WikiError } from './errors'

type Row = Record<string, unknown>

/** Text säubern und Länge prüfen; `what` steht in der Fehlermeldung („Der Titel …“). */
function cleanText(value: unknown, max: number, what: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new WikiError(`${what} fehlt.`)
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text && !allowEmpty) throw new WikiError(`${what} darf nicht leer sein.`)
  if (text.length > max) throw new WikiError(`${what} ist zu lang (höchstens ${max} Zeichen).`)
  return text
}

function cleanDate(value: unknown): string | null {
  if (value === null || value === '' || value === undefined) return null
  if (!isDateString(value)) throw new WikiError('Ungültiges Datum.')
  return value
}

/**
 * Aufgaben in der Wiki-Datei: Buckets, Aufgaben mit Checkliste, Bezeichnungen, Zuweisungen und
 * Kommentaren. Anders als Artikel ohne Verlauf und ohne Freigabe – wie im Planner darf jeder
 * angemeldete Benutzer alles ändern.
 */
export class TaskStore implements TaskRpc {
  constructor(
    private readonly db: DatabaseSync,
    private readonly author: () => string
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

  private depth = 0

  /** Schreibtransaktion (IMMEDIATE wie im übrigen Wiki); verschachtelt läuft sie in der äußeren mit. */
  private tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn()
    this.db.exec('BEGIN IMMEDIATE')
    this.depth++
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    } finally {
      this.depth--
    }
  }

  private now(): string {
    return new Date().toISOString()
  }

  private requireBucket(id: number): void {
    if (!this.get('SELECT 1 FROM task_buckets WHERE id = ?', id)) {
      throw new WikiError('Diesen Bucket gibt es nicht mehr.')
    }
  }

  private requireTask(id: number): { bucket_id: number; progress: TaskProgress } {
    const row = this.get<{ bucket_id: number; progress: TaskProgress }>('SELECT bucket_id, progress FROM tasks WHERE id = ?', id)
    if (!row) throw new WikiError('Diese Aufgabe gibt es nicht mehr.')
    return row
  }

  private requireArticle(id: number): void {
    const row = this.get('SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NULL AND draft_of IS NULL', id)
    if (!row) throw new WikiError('Artikel nicht gefunden.')
  }

  /** Erster Bucket; gibt es keinen, wird „Zu erledigen“ angelegt. */
  private firstBucket(): number {
    const row = this.get<{ id: number }>('SELECT id FROM task_buckets ORDER BY position, id LIMIT 1')
    return row ? row.id : this.createBucket(DEFAULT_BUCKET)
  }

  /** Reiht `ids` in dieser Reihenfolge neu durch (0, 1, 2 …). */
  private renumber(table: string, ids: number[]): void {
    const update = this.db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`)
    ids.forEach((id, pos) => update.run(pos, id))
  }

  /** Tauscht mit dem Nachbarn innerhalb der Gruppe (Tabellen- und Spaltennamen nur aus diesem Modul). */
  private swap(table: string, groupCol: string | null, id: number, direction: -1 | 1): void {
    const where = groupCol ? `WHERE ${groupCol} = (SELECT ${groupCol} FROM ${table} WHERE id = ?)` : ''
    const params = groupCol ? [id] : []
    const ids = this.all<{ id: number }>(`SELECT id FROM ${table} ${where} ORDER BY position, id`, ...params).map((r) => r.id)
    const index = ids.indexOf(id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    this.tx(() => this.renumber(table, ids))
  }

  // ---------- Board ----------

  getTaskBoard(): TaskBoard {
    const buckets = this.all<{ id: number; name: string; position: number }>(
      'SELECT id, name, position FROM task_buckets ORDER BY position, id'
    )
    const labels = this.all<{ id: number; name: string; color: string }>(
      'SELECT id, name, color FROM task_labels ORDER BY position, id'
    )
    const users = this.all<{ username: string; deleted_at: string | null }>(
      'SELECT username, deleted_at FROM users ORDER BY username COLLATE NOCASE'
    ).map((u) => ({ username: u.username, deleted: u.deleted_at != null }))

    const assignees = new Map<number, string[]>()
    for (const r of this.all<{ task_id: number; username: string }>(
      'SELECT task_id, username FROM task_assignees ORDER BY username COLLATE NOCASE'
    )) {
      assignees.set(r.task_id, [...(assignees.get(r.task_id) ?? []), r.username])
    }
    const labelIds = new Map<number, number[]>()
    for (const r of this.all<{ task_id: number; label_id: number }>(
      `SELECT k.task_id, k.label_id FROM task_label_links k JOIN task_labels l ON l.id = k.label_id
        ORDER BY l.position, l.id`
    )) {
      labelIds.set(r.task_id, [...(labelIds.get(r.task_id) ?? []), r.label_id])
    }
    const checklists = new Map<number, TaskCheckItem[]>()
    for (const r of this.all<Row>('SELECT id, task_id, text, checked FROM task_checklist ORDER BY position, id')) {
      const item: TaskCheckItem = {
        id: r.id as number,
        taskId: r.task_id as number,
        text: r.text as string,
        checked: !!r.checked
      }
      checklists.set(item.taskId, [...(checklists.get(item.taskId) ?? []), item])
    }

    const tasks: Task[] = this.all<Row>(
      `SELECT t.*, CASE WHEN a.deleted_at IS NULL THEN a.title END AS article_title,
              (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) AS comment_count
         FROM tasks t
         LEFT JOIN articles a ON a.id = t.article_id
        ORDER BY t.position, t.id`
    ).map((r) => {
      const id = r.id as number
      return {
        id,
        bucketId: r.bucket_id as number,
        title: r.title as string,
        notes: r.notes as string,
        progress: r.progress as TaskProgress,
        priority: r.priority as TaskPriority,
        startDate: (r.start_date as string | null) ?? null,
        dueDate: (r.due_date as string | null) ?? null,
        articleId: (r.article_id as number | null) ?? null,
        articleTitle: (r.article_title as string | null) ?? null,
        preview: (r.preview as TaskPreview) ?? null,
        position: r.position as number,
        createdBy: (r.created_by as string | null) ?? null,
        createdAt: r.created_at as string,
        completedBy: (r.completed_by as string | null) ?? null,
        completedAt: (r.completed_at as string | null) ?? null,
        assignees: assignees.get(id) ?? [],
        labelIds: labelIds.get(id) ?? [],
        checklist: checklists.get(id) ?? [],
        commentCount: r.comment_count as number
      }
    })
    return { buckets, tasks, labels, users }
  }

  // ---------- Buckets ----------

  createBucket(name: string): number {
    const clean = cleanText(name, TASK_LIMITS.bucket, 'Der Name des Buckets')
    const next = this.get<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM task_buckets')?.p ?? 0
    return this.run('INSERT INTO task_buckets (name, position) VALUES (?, ?)', clean, next)
  }

  renameBucket(id: number, name: string): void {
    this.requireBucket(id)
    this.run('UPDATE task_buckets SET name = ? WHERE id = ?', cleanText(name, TASK_LIMITS.bucket, 'Der Name des Buckets'), id)
  }

  moveBucket(id: number, direction: -1 | 1): void {
    this.requireBucket(id)
    this.swap('task_buckets', null, id, direction)
  }

  deleteBucket(id: number): void {
    this.requireBucket(id)
    this.run('DELETE FROM task_buckets WHERE id = ?', id)
  }

  // ---------- Aufgaben ----------

  createTask(bucketId: number | null, title: string, options: NewTaskOptions = {}): number {
    const clean = cleanText(title, TASK_LIMITS.title, 'Der Titel')
    return this.tx(() => {
      const bucket = bucketId == null ? this.firstBucket() : bucketId
      this.requireBucket(bucket)
      // Wie im Planner: neue Aufgaben stehen oben
      const top = this.get<{ p: number }>('SELECT COALESCE(MIN(position), 1) - 1 AS p FROM tasks WHERE bucket_id = ?', bucket)?.p ?? 0
      const id = this.run(
        'INSERT INTO tasks (bucket_id, title, position, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
        bucket,
        clean,
        top,
        this.author(),
        this.now()
      )
      const { assignees, ...patch } = options
      if (Object.keys(patch).length > 0) this.updateTask(id, patch)
      if (assignees?.length) this.setTaskAssignees(id, assignees)
      return id
    })
  }

  updateTask(id: number, patch: TaskPatch): void {
    const task = this.requireTask(id)
    const sets: string[] = []
    const params: SQLInputValue[] = []
    const set = (col: string, value: SQLInputValue): void => {
      sets.push(`${col} = ?`)
      params.push(value)
    }
    if (patch.title !== undefined) set('title', cleanText(patch.title, TASK_LIMITS.title, 'Der Titel'))
    if (patch.notes !== undefined) {
      if (typeof patch.notes !== 'string') throw new WikiError('Ungültige Notizen.')
      if (patch.notes.length > TASK_LIMITS.notes) {
        throw new WikiError(`Die Notizen sind zu lang (höchstens ${TASK_LIMITS.notes} Zeichen).`)
      }
      set('notes', patch.notes.replace(/\s+$/, ''))
    }
    if (patch.priority !== undefined) {
      if (!isTaskPriority(patch.priority)) throw new WikiError('Unbekannte Priorität.')
      set('priority', patch.priority)
    }
    if (patch.progress !== undefined) {
      if (!isTaskProgress(patch.progress)) throw new WikiError('Unbekannter Fortschritt.')
      set('progress', patch.progress)
      // Wer wann erledigt hat, bleibt nur, solange die Aufgabe erledigt ist
      if (patch.progress === 'done' && task.progress !== 'done') {
        set('completed_by', this.author())
        set('completed_at', this.now())
      } else if (patch.progress !== 'done') {
        set('completed_by', null)
        set('completed_at', null)
      }
    }
    if (patch.startDate !== undefined) set('start_date', cleanDate(patch.startDate))
    if (patch.dueDate !== undefined) set('due_date', cleanDate(patch.dueDate))
    if (patch.preview !== undefined) {
      if (!isTaskPreview(patch.preview)) throw new WikiError('Ungültige Vorschau.')
      set('preview', patch.preview)
    }
    if (patch.articleId !== undefined) {
      if (patch.articleId !== null) this.requireArticle(patch.articleId)
      set('article_id', patch.articleId)
    }
    this.tx(() => {
      if (sets.length > 0) this.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, ...params, id)
      if (patch.bucketId !== undefined && patch.bucketId !== task.bucket_id) {
        const first = this.get<{ id: number }>(
          'SELECT id FROM tasks WHERE bucket_id = ? ORDER BY position, id LIMIT 1',
          patch.bucketId
        )
        this.moveTask(id, patch.bucketId, first?.id ?? null)
      }
    })
  }

  moveTask(id: number, bucketId: number, beforeId: number | null): void {
    this.requireTask(id)
    this.requireBucket(bucketId)
    this.tx(() => {
      const ids = this.all<{ id: number }>('SELECT id FROM tasks WHERE bucket_id = ? AND id <> ? ORDER BY position, id', bucketId, id).map(
        (r) => r.id
      )
      const at = beforeId == null ? -1 : ids.indexOf(beforeId)
      ids.splice(at < 0 ? ids.length : at, 0, id)
      this.run('UPDATE tasks SET bucket_id = ? WHERE id = ?', bucketId, id)
      this.renumber('tasks', ids)
    })
  }

  deleteTask(id: number): void {
    this.requireTask(id)
    this.run('DELETE FROM tasks WHERE id = ?', id)
  }

  copyTask(id: number): number {
    const source = this.get<Row>('SELECT * FROM tasks WHERE id = ?', id)
    if (!source) throw new WikiError('Diese Aufgabe gibt es nicht mehr.')
    return this.tx(() => {
      // Direkt unter dem Original einreihen
      const ids = this.all<{ id: number }>('SELECT id FROM tasks WHERE bucket_id = ? ORDER BY position, id', source.bucket_id as number).map(
        (r) => r.id
      )
      const title = `Kopie von ${source.title as string}`.slice(0, TASK_LIMITS.title)
      const copy = this.run(
        `INSERT INTO tasks (bucket_id, title, notes, progress, priority, start_date, due_date, article_id, preview,
                            position, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        source.bucket_id as number,
        title,
        source.notes as string,
        // Eine Kopie ist nie schon erledigt
        source.progress === 'done' ? 'open' : (source.progress as string),
        source.priority as string,
        source.start_date as string | null,
        source.due_date as string | null,
        source.article_id as number | null,
        source.preview as string | null,
        this.author(),
        this.now()
      )
      ids.splice(ids.indexOf(id) + 1, 0, copy)
      this.renumber('tasks', ids)
      this.run('INSERT INTO task_assignees (task_id, username) SELECT ?, username FROM task_assignees WHERE task_id = ?', copy, id)
      this.run('INSERT INTO task_label_links (task_id, label_id) SELECT ?, label_id FROM task_label_links WHERE task_id = ?', copy, id)
      this.run(
        'INSERT INTO task_checklist (task_id, text, checked, position) SELECT ?, text, 0, position FROM task_checklist WHERE task_id = ?',
        copy,
        id
      )
      return copy
    })
  }

  setTaskAssignees(id: number, usernames: string[]): void {
    this.requireTask(id)
    if (!Array.isArray(usernames)) throw new WikiError('Ungültige Zuweisung.')
    const current = new Set(
      this.all<{ username: string }>('SELECT username FROM task_assignees WHERE task_id = ?', id).map((r) => r.username.toLowerCase())
    )
    const names = new Map<string, string>()
    for (const raw of usernames) {
      if (typeof raw !== 'string') throw new WikiError('Ungültige Zuweisung.')
      const user = this.get<{ username: string; deleted_at: string | null }>(
        'SELECT username, deleted_at FROM users WHERE username = ?',
        raw.trim()
      )
      if (!user) throw new WikiError(`Den Benutzer „${raw}“ gibt es nicht.`)
      const key = user.username.toLowerCase()
      // Gelöschte Benutzer bleiben zugewiesen, wenn sie es schon waren – neu zuweisen geht nicht
      if (user.deleted_at && !current.has(key)) throw new WikiError(`„${user.username}“ wurde gelöscht.`)
      names.set(key, user.username)
    }
    this.tx(() => {
      this.run('DELETE FROM task_assignees WHERE task_id = ?', id)
      for (const name of names.values()) this.run('INSERT INTO task_assignees (task_id, username) VALUES (?, ?)', id, name)
    })
  }

  // ---------- Bezeichnungen ----------

  private checkLabel(name: string, color: string, exceptId: number | null): string {
    const clean = cleanText(name, TASK_LIMITS.label, 'Der Name der Bezeichnung')
    if (!isLabelColor(color)) throw new WikiError('Unbekannte Farbe.')
    const twin = this.get<{ id: number }>('SELECT id FROM task_labels WHERE name = ? COLLATE NOCASE AND id IS NOT ?', clean, exceptId)
    if (twin) throw new WikiError(`Die Bezeichnung „${clean}“ gibt es schon.`)
    return clean
  }

  createTaskLabel(name: string, color: string): number {
    const clean = this.checkLabel(name, color, null)
    const next = this.get<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM task_labels')?.p ?? 0
    return this.run('INSERT INTO task_labels (name, color, position) VALUES (?, ?, ?)', clean, color, next)
  }

  updateTaskLabel(id: number, name: string, color: string): void {
    if (!this.get('SELECT 1 FROM task_labels WHERE id = ?', id)) throw new WikiError('Diese Bezeichnung gibt es nicht mehr.')
    const clean = this.checkLabel(name, color, id)
    this.run('UPDATE task_labels SET name = ?, color = ? WHERE id = ?', clean, color, id)
  }

  deleteTaskLabel(id: number): void {
    this.run('DELETE FROM task_labels WHERE id = ?', id)
  }

  setTaskLabels(taskId: number, labelIds: number[]): void {
    this.requireTask(taskId)
    if (!Array.isArray(labelIds)) throw new WikiError('Ungültige Bezeichnungen.')
    const unique = [...new Set(labelIds)]
    for (const labelId of unique) {
      if (!this.get('SELECT 1 FROM task_labels WHERE id = ?', labelId)) throw new WikiError('Diese Bezeichnung gibt es nicht mehr.')
    }
    this.tx(() => {
      this.run('DELETE FROM task_label_links WHERE task_id = ?', taskId)
      for (const labelId of unique) this.run('INSERT INTO task_label_links (task_id, label_id) VALUES (?, ?)', taskId, labelId)
    })
  }

  // ---------- Checkliste ----------

  private requireCheckItem(id: number): void {
    if (!this.get('SELECT 1 FROM task_checklist WHERE id = ?', id)) throw new WikiError('Diesen Punkt gibt es nicht mehr.')
  }

  addTaskCheckItem(taskId: number, text: string): number {
    this.requireTask(taskId)
    const clean = cleanText(text, TASK_LIMITS.checkItem, 'Der Punkt')
    const next =
      this.get<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM task_checklist WHERE task_id = ?', taskId)?.p ?? 0
    return this.run('INSERT INTO task_checklist (task_id, text, position) VALUES (?, ?, ?)', taskId, clean, next)
  }

  updateTaskCheckItem(id: number, text: string): void {
    this.requireCheckItem(id)
    this.run('UPDATE task_checklist SET text = ? WHERE id = ?', cleanText(text, TASK_LIMITS.checkItem, 'Der Punkt'), id)
  }

  setTaskCheckItemChecked(id: number, checked: boolean): void {
    this.requireCheckItem(id)
    this.run('UPDATE task_checklist SET checked = ? WHERE id = ?', checked ? 1 : 0, id)
  }

  deleteTaskCheckItem(id: number): void {
    this.run('DELETE FROM task_checklist WHERE id = ?', id)
  }

  moveTaskCheckItem(id: number, direction: -1 | 1): void {
    this.requireCheckItem(id)
    this.swap('task_checklist', 'task_id', id, direction)
  }

  // ---------- Kommentare ----------

  getTaskComments(taskId: number): TaskComment[] {
    return this.all<Row>('SELECT * FROM task_comments WHERE task_id = ? ORDER BY at DESC, id DESC', taskId).map((r) => ({
      id: r.id as number,
      taskId: r.task_id as number,
      author: r.author as string,
      at: r.at as string,
      text: r.text as string
    }))
  }

  addTaskComment(taskId: number, text: string): number {
    this.requireTask(taskId)
    if (typeof text !== 'string' || !text.trim()) throw new WikiError('Der Kommentar ist leer.')
    const clean = text.trim()
    if (clean.length > TASK_LIMITS.comment) {
      throw new WikiError(`Der Kommentar ist zu lang (höchstens ${TASK_LIMITS.comment} Zeichen).`)
    }
    return this.run('INSERT INTO task_comments (task_id, author, at, text) VALUES (?, ?, ?, ?)', taskId, this.author(), this.now(), clean)
  }

  deleteTaskComment(id: number): void {
    const row = this.get<{ author: string }>('SELECT author FROM task_comments WHERE id = ?', id)
    if (!row) return
    if (row.author.toLowerCase() !== this.author().toLowerCase()) {
      throw new WikiError('Nur eigene Kommentare können gelöscht werden.')
    }
    this.run('DELETE FROM task_comments WHERE id = ?', id)
  }
}
