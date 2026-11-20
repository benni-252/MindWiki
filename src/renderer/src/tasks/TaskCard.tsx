import { Copy, Ellipsis, FileText, ListChecks, MessageSquare, StickyNote, Trash2 } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { PRIORITY_LABEL, PRIORITY_ORDER, PROGRESS_LABEL, PROGRESS_ORDER } from '../../../shared/tasks'
import type { Task, TaskBoard, TaskPriority, TaskProgress } from '../../../shared/types'
import { wiki } from '../api'
import { useWiki } from '../store'
import { patchInBoard } from './board'
import { Avatars, DueChip, LabelChip, PriorityIcon, ProgressIcon, useDismiss } from './parts'

/** Fortschritt ändern – sofort sichtbar, dann gespeichert */
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

export async function deleteTask(task: Task): Promise<boolean> {
  const s = useWiki.getState()
  const ok = await s.confirm({
    title: 'Aufgabe löschen?',
    message: `„${task.title}“ wird endgültig gelöscht – samt Checkliste und Kommentaren.`,
    confirmLabel: 'Löschen',
    danger: true
  })
  if (!ok) return false
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

/** Menü „…“ bzw. Rechtsklick auf einer Karte */
function CardMenu({ task, x, y, onClose }: { task: Task; x: number; y: number; onClose(): void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useDismiss(true, ref, onClose)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8))
    })
  }, [x, y])
  const pick = (fn: () => unknown) => (e: MouseEvent) => {
    e.stopPropagation()
    onClose()
    void fn()
  }
  return (
    <div ref={ref} className="menu task-menu" style={pos} role="menu" onClick={(e) => e.stopPropagation()}>
      <button onClick={pick(() => useWiki.getState().openTask(task.id))}>Details öffnen</button>
      <hr />
      <div className="menu-caption">Fortschritt</div>
      {PROGRESS_ORDER.map((p) => (
        <button key={p} className={task.progress === p ? 'checked' : ''} onClick={pick(() => setProgress(task, p))}>
          <span className="menu-icon-text">
            <ProgressIcon progress={p} size={15} /> {PROGRESS_LABEL[p]}
          </span>
        </button>
      ))}
      <div className="menu-caption">Priorität</div>
      {PRIORITY_ORDER.map((p) => (
        <button key={p} className={task.priority === p ? 'checked' : ''} onClick={pick(() => setPriority(task, p))}>
          <span className="menu-icon-text">
            <span className="prio-slot">
              <PriorityIcon priority={p} always />
            </span>
            {PRIORITY_LABEL[p]}
          </span>
        </button>
      ))}
      <hr />
      <button onClick={pick(() => copyTask(task))}>
        Aufgabe kopieren <Copy size={14} />
      </button>
      <button className="danger" onClick={pick(() => deleteTask(task))}>
        Löschen <Trash2 size={14} />
      </button>
    </div>
  )
}

interface Props {
  task: Task
  board: TaskBoard
  today: string
  dragging?: boolean
  onDragStart?(e: DragEvent<HTMLDivElement>, task: Task): void
  onDragEnd?(): void
}

export function TaskCard({ task, board, today, dragging = false, onDragStart, onDragEnd }: Props): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const done = task.progress === 'done'
  const labels = task.labelIds.map((id) => board.labels.find((l) => l.id === id)).filter((l) => l != null)
  const checked = task.checklist.filter((c) => c.checked).length
  const s = useWiki.getState()

  const toggleItem = (id: number, value: boolean): void => {
    void s.taskAct(
      () => wiki.setTaskCheckItemChecked(id, value),
      (b) =>
        patchInBoard(b, task.id, {
          checklist: task.checklist.map((c) => (c.id === id ? { ...c, checked: value } : c))
        })
    )
  }

  return (
    <div
      className={`task-card ${done ? 'done' : ''} ${dragging ? 'dragging' : ''} ${menu ? 'menu-open' : ''}`}
      data-task-id={task.id}
      data-open={done ? undefined : '1'}
      role="button"
      tabIndex={0}
      aria-label={`Aufgabe ${task.title}`}
      draggable={!!onDragStart}
      onDragStart={(e) => onDragStart?.(e, task)}
      onDragEnd={() => onDragEnd?.()}
      onClick={() => s.openTask(task.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          s.openTask(task.id)
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {labels.length > 0 && (
        <div className="task-labels">
          {labels.map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
        </div>
      )}
      <div className="task-title-row">
        <button
          className="task-check"
          title={done ? 'Als nicht erledigt markieren' : 'Als erledigt markieren'}
          aria-label={done ? 'Als nicht erledigt markieren' : 'Als erledigt markieren'}
          onClick={(e) => {
            e.stopPropagation()
            setProgress(task, done ? 'open' : 'done')
          }}
        >
          <ProgressIcon progress={task.progress} />
        </button>
        <span className="task-title">{task.title}</span>
        <button
          className="task-more"
          title="Weitere Aktionen"
          aria-label="Weitere Aktionen"
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            setMenu({ x: r.left, y: r.bottom + 4 })
          }}
        >
          <Ellipsis size={16} />
        </button>
      </div>

      {task.preview === 'notes' && task.notes && <p className="task-preview-notes">{task.notes}</p>}
      {task.preview === 'checklist' && task.checklist.length > 0 && (
        <ul className="task-preview-checklist">
          {task.checklist.map((item) => (
            <li key={item.id} className={item.checked ? 'checked' : ''}>
              {/* Abhaken direkt auf der Karte, ohne die Details zu öffnen */}
              <label onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={item.checked} onChange={(e) => toggleItem(item.id, e.target.checked)} />
                <span>{item.text}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="task-meta">
        <PriorityIcon priority={task.priority} />
        <DueChip task={task} today={today} />
        {task.checklist.length > 0 && (
          <span className={`task-badge ${checked === task.checklist.length ? 'complete' : ''}`} title="Checkliste">
            <ListChecks size={14} />
            {checked}/{task.checklist.length}
          </span>
        )}
        {task.notes && task.preview !== 'notes' && (
          <span className="task-badge" title="Hat Notizen">
            <StickyNote size={14} />
          </span>
        )}
        {task.commentCount > 0 && (
          <span className="task-badge" title={`${task.commentCount} ${task.commentCount === 1 ? 'Kommentar' : 'Kommentare'}`}>
            <MessageSquare size={14} />
            {task.commentCount}
          </span>
        )}
        {task.articleId != null && (
          <button
            className={`task-article ${task.articleTitle ? '' : 'missing'}`}
            title={task.articleTitle ? `Artikel „${task.articleTitle}“ öffnen` : 'Der verknüpfte Artikel liegt im Papierkorb'}
            disabled={!task.articleTitle}
            onClick={(e) => {
              e.stopPropagation()
              if (task.articleId != null) void s.reveal(task.articleId)
            }}
          >
            <FileText size={13} />
            <span>{task.articleTitle ?? 'Im Papierkorb'}</span>
          </button>
        )}
        <span className="task-meta-end">
          <Avatars names={task.assignees} users={board.users} />
        </span>
      </div>
      {menu && <CardMenu task={task} x={menu.x} y={menu.y} onClose={closeMenu} />}
    </div>
  )
}
