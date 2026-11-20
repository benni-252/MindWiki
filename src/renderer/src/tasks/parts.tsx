import { ArrowDown, Bell, CalendarDays } from 'lucide-react'
import { useEffect, type CSSProperties, type RefObject } from 'react'
import { labelHex, PRIORITY_LABEL, PROGRESS_LABEL } from '../../../shared/tasks'
import type { Task, TaskLabel, TaskPriority, TaskProgress, TaskUser } from '../../../shared/types'
import { avatarColor, initials, isOverdue } from './board'
import { formatDate, formatDue } from './dates'

/** Schließt ein Aufklapp-Menü bei Klick daneben (und mit Esc, außer in Dialogen, die Esc selbst verteilen). */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void, escape = true): void {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (escape && e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, ref, close, escape])
}

export const labelStyle = (color: string): CSSProperties => ({ '--label': labelHex(color) }) as CSSProperties

export function LabelChip({ label, onRemove }: { label: TaskLabel; onRemove?: () => void }): React.JSX.Element {
  return (
    <span className="label-chip" style={labelStyle(label.color)} title={label.name}>
      {label.name}
      {onRemove && (
        <button className="label-chip-x" title={`„${label.name}“ entfernen`} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  )
}

export function Avatar({ name, deleted = false, size = 24 }: { name: string; deleted?: boolean; size?: number }): React.JSX.Element {
  return (
    <span
      className={`avatar ${deleted ? 'deleted' : ''}`}
      style={{ background: avatarColor(name), width: size, height: size, fontSize: Math.round(size * 0.42) }}
      title={deleted ? `${name} (gelöscht)` : name}
      aria-label={name}
    >
      {initials(name)}
    </span>
  )
}

/** Überlappende Avatare wie auf den Planner-Karten; mehr als `max` als „+2“ */
export function Avatars({ names, users, max = 3 }: { names: string[]; users: TaskUser[]; max?: number }): React.JSX.Element | null {
  if (names.length === 0) return null
  const deleted = (n: string): boolean => users.find((u) => u.username.toLowerCase() === n.toLowerCase())?.deleted ?? false
  const shown = names.length > max ? names.slice(0, max - 1) : names
  return (
    <span className="avatars" title={names.join(', ')}>
      {shown.map((n) => (
        <Avatar key={n} name={n} deleted={deleted(n)} />
      ))}
      {names.length > shown.length && <span className="avatar more">+{names.length - shown.length}</span>}
    </span>
  )
}

/** Kreis für den Fortschritt: leer, halb gefüllt (in Bearbeitung) oder grüner Haken */
export function ProgressIcon({ progress, size = 18 }: { progress: TaskProgress; size?: number }): React.JSX.Element {
  return (
    <svg className={`progress-icon ${progress}`} width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      {progress === 'done' ? (
        <>
          <circle cx="10" cy="10" r="9" className="pi-fill" />
          <path d="M5.8 10.4 8.6 13.1 14.3 7.3" className="pi-check" />
        </>
      ) : (
        <>
          <circle cx="10" cy="10" r="8.2" className="pi-ring" />
          {progress === 'active' && <path d="M10 3.4a6.6 6.6 0 0 1 0 13.2Z" className="pi-half" />}
          <path d="M5.8 10.4 8.6 13.1 14.3 7.3" className="pi-hover" />
        </>
      )}
    </svg>
  )
}

export const progressTitle = (p: TaskProgress): string => PROGRESS_LABEL[p]

/** Priorität wie im Planner: Glocke (dringend), Ausrufezeichen (wichtig), Pfeil nach unten (niedrig) */
export function PriorityIcon({ priority, always = false }: { priority: TaskPriority; always?: boolean }): React.JSX.Element | null {
  const title = `Priorität: ${PRIORITY_LABEL[priority]}`
  switch (priority) {
    case 'urgent':
      return (
        <span className="prio-icon urgent" title={title}>
          <Bell size={14} strokeWidth={2.4} />
        </span>
      )
    case 'important':
      return (
        <span className="prio-icon important" title={title}>
          !
        </span>
      )
    case 'low':
      return (
        <span className="prio-icon low" title={title}>
          <ArrowDown size={14} strokeWidth={2.4} />
        </span>
      )
    default:
      return always ? <span className="prio-icon medium" title={title} /> : null
  }
}

/** Fälligkeit; rot, wenn überfällig */
export function DueChip({ task, today }: { task: Task; today: string }): React.JSX.Element | null {
  if (!task.dueDate) return null
  const late = isOverdue(task, today)
  const start = task.startDate ? `Beginn ${formatDate(task.startDate)} · ` : ''
  return (
    <span
      className={`due-chip ${late ? 'late' : ''} ${task.dueDate === today && task.progress !== 'done' ? 'today' : ''}`}
      title={`${start}Fällig am ${formatDate(task.dueDate)}${late ? ' – überfällig' : ''}`}
    >
      <CalendarDays size={13} />
      {formatDue(task.dueDate, today)}
    </span>
  )
}
