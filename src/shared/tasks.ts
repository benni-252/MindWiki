// Aufgaben (Reiter „Aufgaben“, aufgebaut wie der Planner in Microsoft Teams): Bezeichnungen und Grenzen,
// die Hauptprozess und Oberfläche gemeinsam brauchen.

import type { TaskPreview, TaskPriority, TaskProgress } from './types'

export const PROGRESS_ORDER: TaskProgress[] = ['open', 'active', 'done']
export const PROGRESS_LABEL: Record<TaskProgress, string> = {
  open: 'Nicht begonnen',
  active: 'In Bearbeitung',
  done: 'Erledigt'
}

export const PRIORITY_ORDER: TaskPriority[] = ['urgent', 'important', 'medium', 'low']
export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: 'Dringend',
  important: 'Wichtig',
  medium: 'Mittel',
  low: 'Niedrig'
}

/** Farben für Bezeichnungen (wie die farbigen Etiketten im Planner) */
export const LABEL_COLORS = [
  { id: 'red', name: 'Rot', hex: '#e03131' },
  { id: 'orange', name: 'Orange', hex: '#e8590c' },
  { id: 'yellow', name: 'Gelb', hex: '#e0a800' },
  { id: 'green', name: 'Grün', hex: '#2f9e44' },
  { id: 'teal', name: 'Türkis', hex: '#0c8599' },
  { id: 'blue', name: 'Blau', hex: '#1c7ed6' },
  { id: 'purple', name: 'Lila', hex: '#7048e8' },
  { id: 'pink', name: 'Pink', hex: '#d6336c' },
  { id: 'brown', name: 'Braun', hex: '#a0522d' },
  { id: 'gray', name: 'Grau', hex: '#868e96' }
] as const

export type LabelColor = (typeof LABEL_COLORS)[number]['id']

export const labelHex = (color: string): string => LABEL_COLORS.find((c) => c.id === color)?.hex ?? '#868e96'

/** Name des Buckets, der angelegt wird, wenn es noch keinen gibt */
export const DEFAULT_BUCKET = 'Zu erledigen'

/** Aufgaben in einem Bucket mit diesem Namen gelten als erledigt (Groß-/Kleinschreibung egal) */
export const DONE_BUCKET = 'Erledigt'

export const isDoneBucket = (name: string): boolean =>
  name.trim().toLocaleLowerCase('de') === DONE_BUCKET.toLocaleLowerCase('de')

/**
 * Fortschritt, wenn eine Aufgabe in einen anderen Bucket wechselt: in „Erledigt“ hinein → erledigt,
 * aus „Erledigt“ heraus → wieder offen. undefined = bleibt, wie er ist.
 */
export function progressForBucketChange(progress: TaskProgress, fromBucket: string, toBucket: string): TaskProgress | undefined {
  if (isDoneBucket(toBucket)) return progress === 'done' ? undefined : 'done'
  if (isDoneBucket(fromBucket) && progress === 'done') return 'open'
  return undefined
}

export const TASK_LIMITS = {
  title: 255,
  notes: 20_000,
  bucket: 80,
  label: 40,
  checkItem: 500,
  comment: 5_000
} as const

export const isTaskProgress = (v: unknown): v is TaskProgress => PROGRESS_ORDER.includes(v as TaskProgress)
export const isTaskPriority = (v: unknown): v is TaskPriority => PRIORITY_ORDER.includes(v as TaskPriority)
export const isTaskPreview = (v: unknown): v is TaskPreview => v === null || v === 'notes' || v === 'checklist'
export const isLabelColor = (v: unknown): v is LabelColor => LABEL_COLORS.some((c) => c.id === v)

/** Kalendertag als „JJJJ-MM-TT“ (ohne Uhrzeit, damit Zeitzonen keine Rolle spielen) */
export function isDateString(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}
