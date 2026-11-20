import { CalendarDays, CalendarX, Check, ChevronLeft, ChevronRight, Copy, PanelRightOpen, Trash2, UserMinus, UserPlus } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { PRIORITY_LABEL, PRIORITY_ORDER, PROGRESS_LABEL, PROGRESS_ORDER } from '../../../shared/tasks'
import { useWiki } from '../store'
import { formatDue, formatWeekday, quickDueOptions, todayString } from './dates'
import { Avatar, PriorityIcon, ProgressIcon, useDismiss } from './parts'
import { copyTask, deleteTask, setAssignees, setDueDate, setPriority, setProgress, toggleAssignee } from './taskActions'

type View = 'main' | 'priority' | 'due' | 'assign'

interface Props {
  taskId: number
  x: number
  y: number
  onClose(): void
}

/**
 * Kontextmenü einer Aufgabe (Rechtsklick oder „…“): Fortschritt, Priorität, Fälligkeit, Zuweisen,
 * Kopieren, Löschen. Liest die Aufgabe live aus dem Board, damit Häkchen sofort stimmen.
 */
export function TaskMenu({ taskId, x, y, onClose }: Props): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>('main')
  const [pos, setPos] = useState({ left: x, top: y })
  const task = useWiki((s) => s.board?.tasks.find((t) => t.id === taskId))
  const users = useWiki((s) => s.board?.users ?? [])
  const [customDate, setCustomDate] = useState(task?.dueDate ?? '')
  useDismiss(true, ref, onClose)

  // Im Fenster halten – die Höhe hängt von der Ansicht ab
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8))
    })
  }, [view, x, y])

  if (!task) return null
  const today = todayString()

  /** Ausführen und schließen */
  const pick = (fn: () => unknown) => (e: MouseEvent) => {
    e.stopPropagation()
    onClose()
    void fn()
  }
  const open = (next: View) => (e: MouseEvent) => {
    e.stopPropagation()
    setView(next)
  }
  const back = (title: string): React.JSX.Element => (
    <button className="menu-back" onClick={open('main')}>
      <ChevronLeft size={15} /> {title}
    </button>
  )
  const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
  const assigned = (name: string): boolean => task.assignees.some((a) => same(a, name))
  // Aktive Benutzer, dazu gelöschte, solange sie noch zugewiesen sind (zum Entfernen)
  const people = users.filter((u) => !u.deleted || assigned(u.username))

  const menu = (
    <div
      ref={ref}
      className="menu task-menu"
      style={pos}
      role="menu"
      aria-label={`Aktionen für „${task.title}“`}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {view === 'main' && (
        <>
          <button onClick={pick(() => useWiki.getState().openTask(task.id))}>
            Details öffnen <PanelRightOpen size={14} />
          </button>
          <hr />
          {PROGRESS_ORDER.map((p) => (
            <button
              key={p}
              role="menuitemradio"
              aria-checked={task.progress === p}
              className={task.progress === p ? 'checked' : ''}
              onClick={pick(() => setProgress(task, p))}
            >
              <span className="menu-icon-text">
                <ProgressIcon progress={p} size={15} /> {PROGRESS_LABEL[p]}
              </span>
            </button>
          ))}
          <hr />
          <button onClick={open('priority')}>
            <span className="menu-icon-text">
              <span className="prio-slot">
                <PriorityIcon priority={task.priority} always />
              </span>
              Priorität
            </span>
            <span className="menu-value">
              {PRIORITY_LABEL[task.priority]} <ChevronRight size={14} />
            </span>
          </button>
          <button onClick={open('due')}>
            <span className="menu-icon-text">
              <CalendarDays size={15} /> Fälligkeit
            </span>
            <span className="menu-value">
              {task.dueDate ? formatDue(task.dueDate, today) : 'Kein Datum'} <ChevronRight size={14} />
            </span>
          </button>
          <button onClick={open('assign')}>
            <span className="menu-icon-text">
              <UserPlus size={15} /> Zuweisen
            </span>
            <span className="menu-value">
              <span className="menu-value-text">
                {task.assignees.length === 0 ? 'Niemand' : task.assignees.join(', ')}
              </span>
              <ChevronRight size={14} />
            </span>
          </button>
          <hr />
          <button onClick={pick(() => copyTask(task))}>
            Aufgabe kopieren <Copy size={14} />
          </button>
          <button className="danger" onClick={pick(() => deleteTask(task))}>
            Löschen <Trash2 size={14} />
          </button>
        </>
      )}

      {view === 'priority' && (
        <>
          {back('Priorität')}
          {PRIORITY_ORDER.map((p) => (
            <button
              key={p}
              role="menuitemradio"
              aria-checked={task.priority === p}
              className={task.priority === p ? 'checked' : ''}
              onClick={pick(() => setPriority(task, p))}
            >
              <span className="menu-icon-text">
                <span className="prio-slot">
                  <PriorityIcon priority={p} always />
                </span>
                {PRIORITY_LABEL[p]}
              </span>
            </button>
          ))}
        </>
      )}

      {view === 'due' && (
        <>
          {back('Fälligkeit')}
          {quickDueOptions(today).map((o) => (
            <button
              key={o.label}
              role="menuitemradio"
              aria-checked={task.dueDate === o.date}
              className={task.dueDate === o.date ? 'checked' : ''}
              onClick={pick(() => setDueDate(task, o.date))}
            >
              {o.label}
              <span className="menu-value">{formatWeekday(o.date)}</span>
            </button>
          ))}
          <form
            className="task-menu-date"
            onSubmit={(e) => {
              e.preventDefault()
              if (!customDate) return
              onClose()
              setDueDate(task, customDate)
            }}
          >
            <input
              type="date"
              value={customDate}
              aria-label="Fälligkeitsdatum wählen"
              onChange={(e) => setCustomDate(e.target.value)}
            />
            <button type="submit" className="btn btn-small btn-primary" disabled={!customDate || customDate === task.dueDate}>
              Setzen
            </button>
          </form>
          {task.dueDate && (
            <>
              <hr />
              <button onClick={pick(() => setDueDate(task, null))}>
                Datum entfernen <CalendarX size={14} />
              </button>
            </>
          )}
        </>
      )}

      {view === 'assign' && (
        <>
          {back('Zuweisen')}
          <div className="task-menu-people">
            {people.map((u) => (
              <button
                key={u.username}
                role="menuitemcheckbox"
                aria-checked={assigned(u.username)}
                className={`${assigned(u.username) ? 'checked-person' : ''} ${u.deleted ? 'deleted' : ''}`}
                onClick={(e) => {
                  // Bleibt offen: mehrere Personen nacheinander zuweisen
                  e.stopPropagation()
                  toggleAssignee(task, u.username)
                }}
              >
                <span className="menu-icon-text">
                  <Avatar name={u.username} deleted={u.deleted} size={22} />
                  {u.username}
                </span>
                {assigned(u.username) && <Check size={15} />}
              </button>
            ))}
          </div>
          {task.assignees.length > 0 && (
            <>
              <hr />
              <button onClick={pick(() => setAssignees(task, []))}>
                Niemandem zuweisen <UserMinus size={14} />
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
  // Über allem (auch über Tabellenzeilen und Spalten mit eigenem Scrollen)
  return createPortal(menu, document.body)
}

/** Kontextmenü für Aufgaben: `onContextMenu` an Karte, Zeile usw. hängen und `menu` mit ausgeben. */
export function useTaskMenu(): {
  menu: React.ReactNode
  menuTaskId: number | null
  openMenu(taskId: number, x: number, y: number): void
  onContextMenu(taskId: number): (e: MouseEvent) => void
} {
  const [state, setState] = useState<{ taskId: number; x: number; y: number } | null>(null)
  const close = useCallback(() => setState(null), [])
  const openMenu = useCallback((taskId: number, x: number, y: number) => setState({ taskId, x, y }), [])
  const onContextMenu = useCallback(
    (taskId: number) => (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setState({ taskId, x: e.clientX, y: e.clientY })
    },
    []
  )
  return {
    menu: state ? <TaskMenu key={`${state.taskId}-${state.x}-${state.y}`} {...state} onClose={close} /> : null,
    menuTaskId: state?.taskId ?? null,
    openMenu,
    onContextMenu
  }
}
