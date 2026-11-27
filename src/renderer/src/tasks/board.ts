// Board-Logik ohne Oberfläche: Filtern, Gruppieren in Spalten, Ziehen und Sortieren.

import {
  isDoneBucket,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  PROGRESS_LABEL,
  PROGRESS_ORDER,
  progressForBucketChange
} from '../../../shared/tasks'
import type { NewTaskOptions, Task, TaskBoard, TaskBucket, TaskPriority, TaskProgress } from '../../../shared/types'
import { DUE_LABEL, DUE_ORDER, dueDropDate, dueKey, type DueKey } from './dates'

export type GroupBy = 'bucket' | 'progress' | 'priority' | 'assignee' | 'due'

export const GROUP_LABEL: Record<GroupBy, string> = {
  bucket: 'Bucket',
  progress: 'Fortschritt',
  priority: 'Priorität',
  assignee: 'Zugewiesen an',
  due: 'Fälligkeitsdatum'
}

/** Leerer String in `assignees`: „Nicht zugewiesen“ */
export interface TaskFilter {
  text: string
  mine: boolean
  due: DueKey[]
  priority: TaskPriority[]
  labels: number[]
  assignees: string[]
}

export const EMPTY_FILTER: TaskFilter = { text: '', mine: false, due: [], priority: [], labels: [], assignees: [] }

/** Wie viele Filter gesetzt sind (Suchtext zählt nicht mit, er steht sichtbar im Feld) */
export function filterCount(f: TaskFilter): number {
  return (f.mine ? 1 : 0) + f.due.length + f.priority.length + f.labels.length + f.assignees.length
}

const same = (a: string, b: string): boolean => a.toLocaleLowerCase('de') === b.toLocaleLowerCase('de')

export const isAssigned = (task: Task, user: string): boolean => task.assignees.some((u) => same(u, user))

export const isOverdue = (task: Task, today: string): boolean =>
  task.progress !== 'done' && task.dueDate != null && task.dueDate < today

function fold(s: string): string {
  return s
    .toLocaleLowerCase('de')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
}

export function matchesFilter(task: Task, filter: TaskFilter, board: TaskBoard, me: string, today: string): boolean {
  if (filter.mine && !isAssigned(task, me)) return false
  if (filter.priority.length > 0 && !filter.priority.includes(task.priority)) return false
  if (filter.labels.length > 0 && !task.labelIds.some((id) => filter.labels.includes(id))) return false
  if (filter.assignees.length > 0) {
    const hit = filter.assignees.some((u) => (u === '' ? task.assignees.length === 0 : isAssigned(task, u)))
    if (!hit) return false
  }
  if (filter.due.length > 0) {
    const key = dueKey(task.dueDate, today)
    // Erledigte Aufgaben sind nie überfällig
    const hit = filter.due.some((k) => (k === 'overdue' ? isOverdue(task, today) : k === key))
    if (!hit) return false
  }
  const tokens = fold(filter.text).split(/\s+/).filter(Boolean)
  if (tokens.length > 0) {
    const labels = task.labelIds.map((id) => board.labels.find((l) => l.id === id)?.name ?? '')
    const haystack = fold(
      [task.title, task.notes, task.articleTitle ?? '', ...task.assignees, ...labels, ...task.checklist.map((c) => c.text)].join('\n')
    )
    if (!tokens.every((t) => haystack.includes(t))) return false
  }
  return true
}

/** Was passiert, wenn man eine Aufgabe in eine Spalte zieht */
export type DropRule =
  | { kind: 'bucket'; bucketId: number }
  | { kind: 'progress'; progress: TaskProgress }
  | { kind: 'priority'; priority: TaskPriority }
  | { kind: 'assignee'; username: string | null }
  | { kind: 'due'; date: string | null }

export interface BoardColumn {
  key: string
  title: string
  /** Offene Aufgaben (bei „Fortschritt › Erledigt“ und im Bucket „Erledigt“ auch die erledigten) */
  tasks: Task[]
  /** Erledigte Aufgaben – eingeklappt unten in der Spalte */
  completed: Task[]
  bucket?: TaskBucket
  drop: DropRule | null
  /** Startwerte für „Aufgabe hinzufügen“ in dieser Spalte; null = hier nicht möglich */
  add: ({ bucketId: number | null } & NewTaskOptions) | null
  /** Farbton der Kopfzeile (CSS-Klasse) */
  tone?: string
}

/** Reihenfolge wie auf dem Board nach Buckets: Bucket, dann Position */
function boardOrder(board: TaskBoard): (a: Task, b: Task) => number {
  const bucketPos = new Map(board.buckets.map((b, i) => [b.id, i]))
  return (a, b) =>
    (bucketPos.get(a.bucketId) ?? 0) - (bucketPos.get(b.bucketId) ?? 0) || a.position - b.position || a.id - b.id
}

const byCompleted = (a: Task, b: Task): number => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || b.id - a.id

/** `doneInline`: erledigte nicht einklappen, sondern unter den offenen zeigen (zuletzt erledigte zuerst) */
function column(
  key: string,
  title: string,
  tasks: Task[],
  order: (a: Task, b: Task) => number,
  extra: Pick<BoardColumn, 'drop' | 'add'> & Partial<BoardColumn>,
  doneInline = false
): BoardColumn {
  const open = tasks.filter((t) => t.progress !== 'done').sort(order)
  const completed = tasks.filter((t) => t.progress === 'done').sort(byCompleted)
  return doneInline
    ? { key, title, tasks: [...open, ...completed], completed: [], ...extra }
    : { key, title, tasks: open, completed, ...extra }
}

/** Teilt die (gefilterten) Aufgaben in Spalten – je nach Gruppierung wie im Planner. */
export function buildColumns(board: TaskBoard, tasks: Task[], groupBy: GroupBy, today: string): BoardColumn[] {
  const order = boardOrder(board)
  switch (groupBy) {
    case 'bucket':
      return board.buckets.map((bucket) => {
        // Im Bucket „Erledigt“ ist (fast) alles erledigt – dort nichts einklappen
        const done = isDoneBucket(bucket.name)
        return column(
          `bucket-${bucket.id}`,
          bucket.name,
          tasks.filter((t) => t.bucketId === bucket.id),
          (a, b) => a.position - b.position || a.id - b.id,
          {
            bucket,
            drop: { kind: 'bucket', bucketId: bucket.id },
            add: { bucketId: bucket.id },
            tone: done ? 'progress-done' : undefined
          },
          done
        )
      })
    case 'progress':
      return PROGRESS_ORDER.map((progress) =>
        column(
          `progress-${progress}`,
          PROGRESS_LABEL[progress],
          tasks.filter((t) => t.progress === progress),
          order,
          { drop: { kind: 'progress', progress }, add: { bucketId: null, progress }, tone: `progress-${progress}` },
          progress === 'done'
        )
      )
    case 'priority':
      return PRIORITY_ORDER.map((priority) =>
        column(`priority-${priority}`, PRIORITY_LABEL[priority], tasks.filter((t) => t.priority === priority), order, {
          drop: { kind: 'priority', priority },
          add: { bucketId: null, priority },
          tone: `priority-${priority}`
        })
      )
    case 'assignee': {
      // Alle aktiven Benutzer, dazu gelöschte, solange ihnen noch etwas zugewiesen ist
      const names = board.users
        .filter((u) => !u.deleted || tasks.some((t) => isAssigned(t, u.username)))
        .map((u) => u.username)
      for (const t of tasks) for (const u of t.assignees) if (!names.some((n) => same(n, u))) names.push(u)
      return [
        column('assignee-', 'Nicht zugewiesen', tasks.filter((t) => t.assignees.length === 0), order, {
          drop: { kind: 'assignee', username: null },
          add: { bucketId: null }
        }),
        ...names.map((name) => {
          const deleted = board.users.find((u) => same(u.username, name))?.deleted ?? true
          return column(`assignee-${name.toLowerCase()}`, name, tasks.filter((t) => isAssigned(t, name)), order, {
            drop: deleted ? null : { kind: 'assignee', username: name },
            add: deleted ? null : { bucketId: null, assignees: [name] },
            tone: deleted ? 'deleted-user' : undefined
          })
        })
      ]
    }
    case 'due':
      return DUE_ORDER.map((key) => {
        const date = dueDropDate(key, today)
        return column(
          `due-${key}`,
          DUE_LABEL[key],
          tasks.filter((t) => dueKey(t.dueDate, today) === key),
          (a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || order(a, b),
          {
            drop: date === undefined ? null : { kind: 'due', date },
            add: date === undefined ? null : { bucketId: null, dueDate: date },
            tone: key === 'overdue' ? 'overdue' : undefined
          }
        )
      })
  }
}

/** Neue Zuweisung, wenn eine Aufgabe von der Spalte `from` nach `to` gezogen wird (null = „Nicht zugewiesen“) */
export function reassign(assignees: string[], from: string | null, to: string | null): string[] {
  let next = from ? assignees.filter((u) => !same(u, from)) : assignees
  if (to && !next.some((u) => same(u, to))) next = [...next, to]
  return next
}

/**
 * Sofort anzeigen, bevor die Wiki-Datei antwortet: Aufgabe in einen Bucket vor `beforeId` einreihen.
 * Wie in der Wiki-Datei: in den Bucket „Erledigt“ → erledigt, wieder heraus → offen.
 */
export function moveInBoard(board: TaskBoard, taskId: number, bucketId: number, beforeId: number | null): TaskBoard {
  const moving = board.tasks.find((t) => t.id === taskId)
  if (!moving) return board
  const name = (id: number): string => board.buckets.find((b) => b.id === id)?.name ?? ''
  const progress =
    moving.bucketId === bucketId ? undefined : progressForBucketChange(moving.progress, name(moving.bucketId), name(bucketId))
  const status: Partial<Task> = !progress
    ? {}
    : progress === 'done'
      ? { progress, completedAt: new Date().toISOString() }
      : { progress, completedBy: null, completedAt: null }
  const ids = board.tasks
    .filter((t) => t.bucketId === bucketId && t.id !== taskId)
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((t) => t.id)
  const at = beforeId == null ? -1 : ids.indexOf(beforeId)
  ids.splice(at < 0 ? ids.length : at, 0, taskId)
  const pos = new Map(ids.map((id, i) => [id, i]))
  return {
    ...board,
    tasks: board.tasks.map((t) =>
      pos.has(t.id)
        ? { ...t, ...(t.id === taskId ? { bucketId, ...status } : {}), position: pos.get(t.id)! }
        : t
    )
  }
}

export function patchInBoard(board: TaskBoard, taskId: number, patch: Partial<Task>): TaskBoard {
  return { ...board, tasks: board.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) }
}

export type SortKey = 'bucket' | 'title' | 'assignees' | 'progress' | 'due' | 'priority' | 'labels'

/** Für die Listenansicht; erledigte Aufgaben stehen immer unten */
export function sortTasks(tasks: Task[], board: TaskBoard, key: SortKey, desc: boolean): Task[] {
  const order = boardOrder(board)
  const labelName = (t: Task): string => board.labels.find((l) => l.id === t.labelIds[0])?.name ?? '￿'
  const compare: Record<SortKey, (a: Task, b: Task) => number> = {
    bucket: order,
    title: (a, b) => a.title.localeCompare(b.title, 'de'),
    assignees: (a, b) => (a.assignees[0] ?? '￿').localeCompare(b.assignees[0] ?? '￿', 'de'),
    progress: (a, b) => PROGRESS_ORDER.indexOf(a.progress) - PROGRESS_ORDER.indexOf(b.progress),
    // Ohne Datum ans Ende
    due: (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
    priority: (a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority),
    labels: (a, b) => labelName(a).localeCompare(labelName(b), 'de')
  }
  return [...tasks].sort((a, b) => {
    if (key !== 'progress' && (a.progress === 'done') !== (b.progress === 'done')) return a.progress === 'done' ? 1 : -1
    const c = compare[key](a, b)
    return (desc ? -c : c) || order(a, b)
  })
}

export interface TaskSummary {
  total: number
  open: number
  active: number
  done: number
  overdue: number
}

export function summarize(tasks: Task[], today: string): TaskSummary {
  return {
    total: tasks.length,
    open: tasks.filter((t) => t.progress === 'open').length,
    active: tasks.filter((t) => t.progress === 'active').length,
    done: tasks.filter((t) => t.progress === 'done').length,
    overdue: tasks.filter((t) => isOverdue(t, today)).length
  }
}

/** Kürzel für den runden Avatar: „anna.schmidt“ → „AS“, „Ben“ → „BE“ */
export function initials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toLocaleUpperCase('de')
  return name.slice(0, 2).toLocaleUpperCase('de')
}

const AVATAR_COLORS = ['#4f5bd5', '#0c8599', '#2f9e44', '#e8590c', '#d6336c', '#7048e8', '#1c7ed6', '#a0522d']

export function avatarColor(name: string): string {
  let h = 0
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
