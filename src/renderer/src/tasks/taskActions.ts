// Änderungen an einer Aufgabe – sofort sichtbar, dann in der Wiki-Datei gespeichert.

import { attachmentProblem } from '../../../shared/attachments'
import type { Task, TaskPriority, TaskProgress } from '../../../shared/types'
import { errorMessage, wiki } from '../api'
import { useWiki } from '../store'
import { patchInBoard } from './board'

export function setProgress(task: Task, progress: TaskProgress): void {
  const { taskAct, userName } = useWiki.getState()
  const done = progress === 'done'
  void taskAct(
    () => wiki.updateTask(task.id, { progress }),
    (b) =>
      patchInBoard(b, task.id, {
        progress,
        completedBy: done ? (task.completedBy ?? userName) : null,
        completedAt: done ? (task.completedAt ?? new Date().toISOString()) : null
      })
  )
}

export function setPriority(task: Task, priority: TaskPriority): void {
  void useWiki.getState().taskAct(
    () => wiki.updateTask(task.id, { priority }),
    (b) => patchInBoard(b, task.id, { priority })
  )
}

/** Fälligkeit setzen (null: kein Datum) */
export function setDueDate(task: Task, dueDate: string | null): void {
  void useWiki.getState().taskAct(
    () => wiki.updateTask(task.id, { dueDate }),
    (b) => patchInBoard(b, task.id, { dueDate })
  )
}

export function setAssignees(task: Task, assignees: string[]): void {
  void useWiki.getState().taskAct(
    () => wiki.setTaskAssignees(task.id, assignees),
    (b) => patchInBoard(b, task.id, { assignees })
  )
}

/** Person zuweisen bzw. wieder entfernen */
export function toggleAssignee(task: Task, name: string): void {
  const has = task.assignees.some((a) => a.toLowerCase() === name.toLowerCase())
  setAssignees(task, has ? task.assignees.filter((a) => a.toLowerCase() !== name.toLowerCase()) : [...task.assignees, name])
}

export async function deleteTask(task: Task): Promise<boolean> {
  const s = useWiki.getState()
  const ok = await s.confirm({
    title: 'Aufgabe löschen?',
    message: `„${task.title}“ wird endgültig gelöscht – samt Checkliste, Kommentaren und Anhängen.`,
    confirmLabel: 'Löschen',
    danger: true
  })
  if (!ok) return false
  if (s.openTaskId === task.id) s.openTask(null)
  await s.taskAct(
    () => wiki.deleteTask(task.id),
    (b) => ({ ...b, tasks: b.tasks.filter((t) => t.id !== task.id) })
  )
  return true
}

export async function copyTask(task: Task): Promise<number | undefined> {
  const s = useWiki.getState()
  const id = await s.taskAct(() => wiki.copyTask(task.id))
  if (id != null) s.toast('Aufgabe kopiert.')
  return id
}

/** Nach dem Anhängen: Board auffrischen (Zähler auf der Karte, Liste in den Details), Ergebnis melden */
async function afterAttach(added: number, problems: string[]): Promise<void> {
  const s = useWiki.getState()
  if (added > 0) {
    await s.loadBoard().catch(() => undefined)
    s.toast(added === 1 ? 'Datei angehängt.' : `${added} Dateien angehängt.`)
  }
  if (problems.length > 0) s.toast(problems.join(' '), 'error')
}

/** Dateien aus dem Explorer (auf Karte oder Details gezogen) an eine Aufgabe hängen */
export async function attachFilesToTask(taskId: number, files: File[]): Promise<void> {
  let added = 0
  const problems: string[] = []
  for (const file of files) {
    // Früh prüfen, damit große Dateien gar nicht erst gelesen werden (verbindlich prüft der Hauptprozess)
    const problem = attachmentProblem(file.name, file.size)
    if (problem) {
      problems.push(problem)
      continue
    }
    try {
      await wiki.addTaskAttachment(taskId, file.name, new Uint8Array(await file.arrayBuffer()))
      added++
    } catch (err) {
      problems.push(errorMessage(err))
    }
  }
  await afterAttach(added, problems)
}

/** Datei-Dialog zum Anhängen (mehrere Dateien möglich) */
export async function pickTaskAttachments(taskId: number): Promise<void> {
  try {
    const result = await wiki.addTaskAttachmentFiles(taskId)
    await afterAttach(result.added, result.skipped)
  } catch (err) {
    useWiki.getState().toast(errorMessage(err), 'error')
  }
}
