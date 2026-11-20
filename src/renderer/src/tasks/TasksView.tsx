import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Funnel,
  List,
  ListTodo,
  Pencil,
  Plus,
  Search,
  SquareKanban,
  Trash2,
  UserRound,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { PRIORITY_LABEL, PRIORITY_ORDER, TASK_LIMITS } from '../../../shared/tasks'
import type { Task, TaskBoard, TaskBucket } from '../../../shared/types'
import { wiki } from '../api'
import { useWiki } from '../store'
import {
  buildColumns,
  EMPTY_FILTER,
  filterCount,
  GROUP_LABEL,
  matchesFilter,
  moveInBoard,
  patchInBoard,
  reassign,
  summarize,
  type BoardColumn,
  type GroupBy,
  type TaskFilter
} from './board'
import { DUE_LABEL, DUE_ORDER, todayString } from './dates'
import { Avatar, LabelChip, PriorityIcon, useDismiss } from './parts'
import { TaskCard } from './TaskCard'
import { TaskList } from './TaskList'

type Mode = 'board' | 'list'

function readSetting<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}

function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // nur Komfort
  }
}

const GROUPS: GroupBy[] = ['bucket', 'progress', 'priority', 'assignee', 'due']

/** Heutiges Datum, das auch über Mitternacht stimmt */
function useToday(): string {
  const [today, setToday] = useState(todayString)
  useEffect(() => {
    const t = setInterval(() => setToday(todayString()), 60_000)
    return () => clearInterval(t)
  }, [])
  return today
}

// ---------- Kopfzeile ----------

function GroupMenu({ value, onChange }: { value: GroupBy; onChange(g: GroupBy): void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, ref, close)
  return (
    <div className="tasks-dropdown" ref={ref}>
      <button className={`btn btn-small ${open ? 'active' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Gruppieren nach: <strong>{GROUP_LABEL[value]}</strong>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="menu dropdown align-right" role="menu">
          {GROUPS.map((g) => (
            <button
              key={g}
              role="menuitemradio"
              aria-checked={g === value}
              className={g === value ? 'checked' : ''}
              onClick={() => {
                onChange(g)
                setOpen(false)
              }}
            >
              {GROUP_LABEL[g]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function FilterMenu({
  filter,
  board,
  onChange
}: {
  filter: TaskFilter
  board: TaskBoard
  onChange(f: TaskFilter): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, ref, close)
  const count = filterCount(filter) - (filter.mine ? 1 : 0)
  const check = (checked: boolean, label: React.ReactNode, onToggle: () => void, key: string): React.JSX.Element => (
    <label key={key} className="filter-option">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      {label}
    </label>
  )
  return (
    <div className="tasks-dropdown" ref={ref}>
      <button
        className={`btn btn-small ${count > 0 ? 'btn-on' : ''}`}
        aria-expanded={open}
        title="Aufgaben filtern"
        onClick={() => setOpen((o) => !o)}
      >
        <Funnel size={14} />
        Filter{count > 0 ? ` (${count})` : ''}
      </button>
      {open && (
        <div className="menu dropdown align-right filter-menu">
          <div className="filter-head">
            <strong>Filter</strong>
            <button
              className="btn btn-small"
              disabled={count === 0}
              onClick={() => onChange({ ...EMPTY_FILTER, text: filter.text, mine: filter.mine })}
            >
              Alle löschen
            </button>
          </div>
          <div className="filter-group">
            <h4>Fälligkeit</h4>
            {DUE_ORDER.map((k) =>
              check(filter.due.includes(k), DUE_LABEL[k], () => onChange({ ...filter, due: toggle(filter.due, k) }), k)
            )}
          </div>
          <div className="filter-group">
            <h4>Priorität</h4>
            {PRIORITY_ORDER.map((p) =>
              check(
                filter.priority.includes(p),
                <>
                  <span className="prio-slot">
                    <PriorityIcon priority={p} always />
                  </span>
                  {PRIORITY_LABEL[p]}
                </>,
                () => onChange({ ...filter, priority: toggle(filter.priority, p) }),
                p
              )
            )}
          </div>
          {board.labels.length > 0 && (
            <div className="filter-group">
              <h4>Bezeichnungen</h4>
              {board.labels.map((l) =>
                check(
                  filter.labels.includes(l.id),
                  <LabelChip label={l} />,
                  () => onChange({ ...filter, labels: toggle(filter.labels, l.id) }),
                  `l${l.id}`
                )
              )}
            </div>
          )}
          <div className="filter-group">
            <h4>Zugewiesen an</h4>
            {check(
              filter.assignees.includes(''),
              <span className="muted">Nicht zugewiesen</span>,
              () => onChange({ ...filter, assignees: toggle(filter.assignees, '') }),
              'none'
            )}
            {board.users
              .filter((u) => !u.deleted)
              .map((u) =>
                check(
                  filter.assignees.includes(u.username),
                  <>
                    <Avatar name={u.username} size={20} /> {u.username}
                  </>,
                  () => onChange({ ...filter, assignees: toggle(filter.assignees, u.username) }),
                  `u${u.username}`
                )
              )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Board ----------

function BucketTitle({ bucket, renaming, onDone }: { bucket: TaskBucket; renaming: boolean; onDone(): void }): React.JSX.Element {
  const [value, setValue] = useState(bucket.name)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renaming) {
      setValue(bucket.name)
      requestAnimationFrame(() => input.current?.select())
    }
  }, [renaming, bucket.name])
  if (!renaming) return <h2 title={bucket.name}>{bucket.name}</h2>
  const commit = (): void => {
    onDone()
    const name = value.trim()
    if (name && name !== bucket.name) void useWiki.getState().taskAct(() => wiki.renameBucket(bucket.id, name))
  }
  return (
    <input
      ref={input}
      className="bucket-rename"
      value={value}
      maxLength={TASK_LIMITS.bucket}
      aria-label="Name des Buckets"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          e.stopPropagation()
          setValue(bucket.name)
          onDone()
        }
      }}
    />
  )
}

function BucketMenu({
  bucket,
  first,
  last,
  taskCount,
  onRename
}: {
  bucket: TaskBucket
  first: boolean
  last: boolean
  taskCount: number
  onRename(): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, ref, close)
  const s = useWiki.getState()
  const pick = (fn: () => unknown) => () => {
    setOpen(false)
    void fn()
  }
  const remove = async (): Promise<void> => {
    const ok = await s.confirm({
      title: 'Bucket löschen?',
      message:
        taskCount > 0
          ? `„${bucket.name}“ und ${taskCount === 1 ? 'die Aufgabe' : `alle ${taskCount} Aufgaben`} darin werden endgültig gelöscht.`
          : `Der leere Bucket „${bucket.name}“ wird gelöscht.`,
      confirmLabel: 'Löschen',
      danger: true
    })
    if (ok) await s.taskAct(() => wiki.deleteBucket(bucket.id))
  }
  return (
    <div className="tasks-dropdown" ref={ref}>
      <button className="icon-btn small" title="Bucket-Aktionen" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis size={16} />
      </button>
      {open && (
        <div className="menu dropdown align-right" role="menu">
          <button onClick={pick(onRename)}>
            Umbenennen <Pencil size={14} />
          </button>
          <button disabled={first} onClick={pick(() => s.taskAct(() => wiki.moveBucket(bucket.id, -1)))}>
            Nach links <ArrowLeft size={14} />
          </button>
          <button disabled={last} onClick={pick(() => s.taskAct(() => wiki.moveBucket(bucket.id, 1)))}>
            Nach rechts <ArrowRight size={14} />
          </button>
          <hr />
          <button className="danger" onClick={pick(remove)}>
            Bucket löschen <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

/** „+ Aufgabe hinzufügen“ oben in einer Spalte – bleibt für die nächste offen, wie im Planner */
function AddTask({ column }: { column: BoardColumn }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const ref = useRef<HTMLFormElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    setTitle('')
    setDue('')
  }, [])
  // Klick daneben schließt das leere Formular
  useDismiss(open && !title.trim(), ref, close)
  if (!column.add) return null
  const add = column.add
  if (!open) {
    return (
      <button className="add-task-btn" onClick={() => setOpen(true)}>
        <Plus size={15} /> Aufgabe hinzufügen
      </button>
    )
  }
  const submit = async (): Promise<void> => {
    const text = title.trim()
    if (!text) return
    const { bucketId, ...options } = add
    setTitle('')
    await useWiki.getState().taskAct(() => wiki.createTask(bucketId, text, { ...options, ...(due ? { dueDate: due } : {}) }))
    input.current?.focus()
  }
  return (
    <form
      ref={ref}
      className="add-task-form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          close()
        }
      }}
    >
      <input
        ref={input}
        autoFocus
        value={title}
        maxLength={TASK_LIMITS.title}
        placeholder="Aufgabenname eingeben"
        aria-label="Name der neuen Aufgabe"
        onChange={(e) => setTitle(e.target.value)}
      />
      {!add.dueDate && (
        <label className="add-task-due">
          <span>Fällig</span>
          <input type="date" value={due} aria-label="Fälligkeitsdatum" onChange={(e) => setDue(e.target.value)} />
        </label>
      )}
      <div className="row-end">
        <button type="button" className="btn btn-small" onClick={close}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn-small btn-primary" disabled={!title.trim()}>
          Aufgabe hinzufügen
        </button>
      </div>
    </form>
  )
}

function AddBucket(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const submit = async (): Promise<void> => {
    const text = name.trim()
    if (!text) return
    setName('')
    setOpen(false)
    await useWiki.getState().taskAct(() => wiki.createBucket(text))
  }
  return (
    <div className="board-col add-bucket">
      {open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <input
            autoFocus
            value={name}
            maxLength={TASK_LIMITS.bucket}
            placeholder="Name des Buckets"
            aria-label="Name des neuen Buckets"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => !name.trim() && setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setName('')
                setOpen(false)
              }
            }}
          />
          <div className="row-end">
            <button type="submit" className="btn btn-small btn-primary" disabled={!name.trim()}>
              Bucket hinzufügen
            </button>
          </div>
        </form>
      ) : (
        <button className="add-bucket-btn" onClick={() => setOpen(true)}>
          <Plus size={16} /> Neuen Bucket hinzufügen
        </button>
      )}
    </div>
  )
}

interface Drag {
  taskId: number
  from: string
}

function Board({
  board,
  columns,
  groupBy,
  today,
  filtered
}: {
  board: TaskBoard
  columns: BoardColumn[]
  groupBy: GroupBy
  today: string
  filtered: boolean
}): React.JSX.Element {
  // Für die Logik sofort im Ref (dragover kommt evtl. vor dem nächsten Bild), für die Anzeige im State
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [over, setOver] = useState<{ key: string; beforeId: number | null } | null>(null)
  const [showDone, setShowDone] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<number | null>(null)

  const onDragStart = (e: DragEvent<HTMLDivElement>, task: Task, column: BoardColumn): void => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(task.id))
    const current = { taskId: task.id, from: column.key }
    dragRef.current = current
    // Erst nach dem Start abblenden, sonst zeigt das Ziehbild die abgeblendete Karte
    requestAnimationFrame(() => dragRef.current === current && setDrag(current))
  }
  const endDrag = (): void => {
    dragRef.current = null
    setDrag(null)
    setOver(null)
  }

  const canDrop = (column: BoardColumn, current = dragRef.current): boolean =>
    !!current && !!column.drop && (column.drop.kind === 'bucket' || current.from !== column.key)

  const onDragOver = (e: DragEvent<HTMLDivElement>, column: BoardColumn): void => {
    if (!canDrop(column)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    let beforeId: number | null = null
    if (column.drop?.kind === 'bucket') {
      // Vor der ersten offenen Karte, deren Mitte unter dem Mauszeiger liegt
      const cards = e.currentTarget.querySelectorAll<HTMLElement>('.task-card[data-open="1"]')
      for (const el of cards) {
        const id = Number(el.dataset.taskId)
        if (id === dragRef.current?.taskId) continue
        const r = el.getBoundingClientRect()
        if (e.clientY < r.top + r.height / 2) {
          beforeId = id
          break
        }
      }
    }
    if (over?.key !== column.key || over.beforeId !== beforeId) setOver({ key: column.key, beforeId })
  }

  const onDrop = (e: DragEvent<HTMLDivElement>, column: BoardColumn): void => {
    e.preventDefault()
    const target = over?.key === column.key ? over : { key: column.key, beforeId: null }
    const current = dragRef.current
    endDrag()
    if (!current || !column.drop) return
    const task = board.tasks.find((t) => t.id === current.taskId)
    if (!task) return
    const { taskAct } = useWiki.getState()
    const rule = column.drop
    switch (rule.kind) {
      case 'bucket': {
        const beforeId = target.beforeId
        void taskAct(
          () => wiki.moveTask(task.id, rule.bucketId, beforeId),
          (b) => moveInBoard(b, task.id, rule.bucketId, beforeId)
        )
        break
      }
      case 'progress':
      case 'priority':
      case 'due': {
        const patch =
          rule.kind === 'progress'
            ? { progress: rule.progress }
            : rule.kind === 'priority'
              ? { priority: rule.priority }
              : { dueDate: rule.date }
        void taskAct(
          () => wiki.updateTask(task.id, patch),
          (b) => patchInBoard(b, task.id, patch)
        )
        break
      }
      case 'assignee': {
        const fromRule = columns.find((c) => c.key === current.from)?.drop
        const from = fromRule?.kind === 'assignee' ? fromRule.username : null
        const next = reassign(task.assignees, from, rule.username)
        void taskAct(
          () => wiki.setTaskAssignees(task.id, next),
          (b) => patchInBoard(b, task.id, { assignees: next })
        )
        break
      }
    }
  }

  const empty = board.buckets.length === 0 && groupBy === 'bucket'

  return (
    <div className="board" onDragEnd={endDrag}>
      {empty && (
        <div className="board-empty">
          <ListTodo size={28} />
          <h2>Noch keine Aufgaben</h2>
          <p>
            Lege rechts einen Bucket an – zum Beispiel <em>Zu erledigen</em>, <em>Diese Woche</em> oder nach Themen wie{' '}
            <em>Server</em> und <em>Arbeitsplätze</em> – oder klicke oben auf <strong>Neue Aufgabe</strong>.
          </p>
        </div>
      )}
      {columns.map((column, index) => {
        const bucket = column.bucket
        const isOver = over?.key === column.key
        const expanded = showDone.has(column.key)
        const card = (task: Task): React.JSX.Element => (
          <TaskCard
            key={task.id}
            task={task}
            board={board}
            today={today}
            dragging={drag?.taskId === task.id}
            onDragStart={(e, t) => onDragStart(e, t, column)}
            onDragEnd={endDrag}
          />
        )
        const total = bucket ? board.tasks.filter((t) => t.bucketId === bucket.id).length : 0
        return (
          <section
            key={column.key}
            className={`board-col ${column.tone ?? ''} ${isOver ? 'drop-over' : ''} ${drag && !canDrop(column, drag) && drag.from !== column.key ? 'no-drop' : ''}`}
            aria-label={column.title}
          >
            <header className="col-head">
              {bucket ? (
                <div className="col-title" onDoubleClick={() => setRenaming(bucket.id)}>
                  <BucketTitle bucket={bucket} renaming={renaming === bucket.id} onDone={() => setRenaming(null)} />
                </div>
              ) : (
                <div className="col-title">
                  <h2 title={column.title}>{column.title}</h2>
                </div>
              )}
              <span className="col-count" title="Offene Aufgaben">
                {column.tasks.length}
              </span>
              {bucket && (
                <BucketMenu
                  bucket={bucket}
                  first={index === 0}
                  last={index === columns.length - 1}
                  taskCount={total}
                  onRename={() => setRenaming(bucket.id)}
                />
              )}
            </header>
            <AddTask column={column} />
            <div
              className="col-body"
              onDragOver={(e) => onDragOver(e, column)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null) && over?.key === column.key) setOver(null)
              }}
              onDrop={(e) => onDrop(e, column)}
            >
              {column.tasks.map((task) => (
                <div key={task.id} className="card-slot">
                  {isOver && over?.beforeId === task.id && <div className="drop-line" />}
                  {card(task)}
                </div>
              ))}
              {isOver && over?.beforeId == null && <div className="drop-line" />}
              {column.tasks.length === 0 && column.completed.length === 0 && (
                <p className="col-empty">{filtered ? 'Nichts passt zum Filter.' : drag ? 'Hierher ziehen' : 'Keine Aufgaben'}</p>
              )}
              {column.completed.length > 0 && (
                <>
                  <button
                    className="done-toggle"
                    aria-expanded={expanded}
                    onClick={() =>
                      setShowDone((prev) => {
                        const next = new Set(prev)
                        if (next.has(column.key)) next.delete(column.key)
                        else next.add(column.key)
                        return next
                      })
                    }
                  >
                    {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    Erledigt <span className="col-count">{column.completed.length}</span>
                  </button>
                  {expanded && column.completed.map(card)}
                </>
              )}
            </div>
          </section>
        )
      })}
      {groupBy === 'bucket' && <AddBucket key={board.buckets.length} />}
    </div>
  )
}

// ---------- Reiter ----------

export function TasksView(): React.JSX.Element {
  const board = useWiki((s) => s.board)
  const userName = useWiki((s) => s.userName)
  const [mode, setMode] = useState<Mode>(() => readSetting('mindwiki.tasks.mode', ['board', 'list'] as const, 'board'))
  const [groupBy, setGroupBy] = useState<GroupBy>(() => readSetting('mindwiki.tasks.groupBy', GROUPS, 'bucket'))
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_FILTER)
  const today = useToday()
  const searchRef = useRef<HTMLInputElement>(null)

  const tasks = useMemo(
    () => (board ? board.tasks.filter((t) => matchesFilter(t, filter, board, userName, today)) : []),
    [board, filter, userName, today]
  )
  const columns = useMemo(() => (board ? buildColumns(board, tasks, groupBy, today) : []), [board, tasks, groupBy, today])

  // Strg+F sucht in den Aufgaben
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        // Nicht hinter einem offenen Dialog
        if (document.querySelector('.modal-backdrop')) return
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!board) return <section className="tasks-view loading">Lade Aufgaben …</section>

  const summary = summarize(board.tasks, today)
  const filtered = filterCount(filter) > 0 || filter.text.trim() !== ''

  const newTask = async (): Promise<void> => {
    const s = useWiki.getState()
    const id = await s.taskAct(() => wiki.createTask(null, 'Neue Aufgabe', filter.mine ? { assignees: [userName] } : {}))
    if (id != null) s.openTask(id, true)
  }

  return (
    <section className="tasks-view" aria-label="Aufgaben">
      <header className="tasks-head">
        <div className="tasks-title">
          <span className="tasks-logo">
            <ListTodo size={18} />
          </span>
          <div>
            <h1>Aufgaben</h1>
            <span className="tasks-summary">
              {summary.total === 0 ? (
                'Noch keine Aufgaben'
              ) : (
                <>
                  {summary.total - summary.done} offen · {summary.done} erledigt
                  {summary.overdue > 0 && <strong className="late"> · {summary.overdue} überfällig</strong>}
                </>
              )}
            </span>
          </div>
        </div>
        <div className="tasks-modes" role="tablist" aria-label="Darstellung">
          <button
            role="tab"
            aria-selected={mode === 'board'}
            className={mode === 'board' ? 'active' : ''}
            onClick={() => {
              setMode('board')
              writeSetting('mindwiki.tasks.mode', 'board')
            }}
          >
            <SquareKanban size={15} /> Board
          </button>
          <button
            role="tab"
            aria-selected={mode === 'list'}
            className={mode === 'list' ? 'active' : ''}
            onClick={() => {
              setMode('list')
              writeSetting('mindwiki.tasks.mode', 'list')
            }}
          >
            <List size={15} /> Liste
          </button>
        </div>
        <div className="tasks-tools">
          <div className="tasks-search">
            <Search size={14} />
            <input
              ref={searchRef}
              value={filter.text}
              placeholder="Aufgaben filtern (Strg+F)"
              aria-label="Aufgaben filtern"
              onChange={(e) => setFilter({ ...filter, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setFilter({ ...filter, text: '' })
              }}
            />
            {filter.text && (
              <button className="icon-btn small" title="Suche leeren" onClick={() => setFilter({ ...filter, text: '' })}>
                <X size={13} />
              </button>
            )}
          </div>
          <button
            className={`btn btn-small ${filter.mine ? 'btn-on' : ''}`}
            aria-pressed={filter.mine}
            title="Nur Aufgaben zeigen, die mir zugewiesen sind"
            onClick={() => setFilter({ ...filter, mine: !filter.mine })}
          >
            <UserRound size={14} /> Mir zugewiesen
          </button>
          <FilterMenu filter={filter} board={board} onChange={setFilter} />
          {mode === 'board' && (
            <GroupMenu
              value={groupBy}
              onChange={(g) => {
                setGroupBy(g)
                writeSetting('mindwiki.tasks.groupBy', g)
              }}
            />
          )}
          <button className="btn btn-small btn-primary" onClick={() => void newTask()}>
            <Plus size={15} /> Neue Aufgabe
          </button>
        </div>
      </header>
      {mode === 'board' ? (
        <Board board={board} columns={columns} groupBy={groupBy} today={today} filtered={filtered} />
      ) : (
        <TaskList board={board} tasks={tasks} today={today} filtered={filtered} />
      )}
    </section>
  )
}
