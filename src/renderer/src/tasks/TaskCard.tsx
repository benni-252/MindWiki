import { Ellipsis, FileText, ListChecks, MessageSquare, Paperclip, StickyNote } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import type { Task, TaskBoard } from '../../../shared/types'
import { wiki } from '../api'
import { hasFiles } from '../article/Attachments'
import { useWiki } from '../store'
import { isOverdue, patchInBoard } from './board'
import { Avatars, DueChip, LabelChip, PriorityIcon, ProgressIcon } from './parts'
import { attachFilesToTask, deleteTask, setProgress } from './taskActions'
import { useTaskMenu } from './TaskMenu'

interface Props {
  task: Task
  board: TaskBoard
  today: string
  dragging?: boolean
  onDragStart?(e: DragEvent<HTMLDivElement>, task: Task): void
  onDragEnd?(): void
}

export function TaskCard({ task, board, today, dragging = false, onDragStart, onDragEnd }: Props): React.JSX.Element {
  const { menu, menuTaskId, openMenu, onContextMenu } = useTaskMenu()
  const done = task.progress === 'done'
  const late = isOverdue(task, today)
  // Datei aus dem Explorer über der Karte
  const [fileOver, setFileOver] = useState(false)
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
      className={`task-card ${done ? 'done' : ''} ${late ? 'overdue' : ''} ${fileOver ? 'file-over' : ''} ${dragging ? 'dragging' : ''} ${menuTaskId != null ? 'menu-open' : ''}`}
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
        } else if (e.key === 'Delete') {
          e.preventDefault()
          void deleteTask(task)
        } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
          // Kontextmenü auch per Tastatur
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          openMenu(task.id, r.left + 12, r.top + 24)
        }
      }}
      onContextMenu={onContextMenu(task.id)}
      // Dateien auf die Karte ziehen hängt sie an (Karten selbst ziehen bleibt unberührt: dabei gibt es keine Dateien)
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        if (!fileOver) setFileOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileOver(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        setFileOver(false)
        const files = [...e.dataTransfer.files]
        if (files.length > 0) void attachFilesToTask(task.id, files)
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
            openMenu(task.id, r.left, r.bottom + 4)
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
        {task.attachmentCount > 0 && (
          <span
            className="task-badge"
            title={`${task.attachmentCount} ${task.attachmentCount === 1 ? 'Anhang' : 'Anhänge'}`}
          >
            <Paperclip size={14} />
            {task.attachmentCount}
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
      {fileOver && <div className="task-file-drop">Loslassen zum Anhängen</div>}
      {menu}
    </div>
  )
}
