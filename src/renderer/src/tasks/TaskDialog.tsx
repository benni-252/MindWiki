import { ArrowDown, ArrowUp, Check, Copy, FileText, Link2, Pencil, Plus, Send, Tag, Trash2, UserPlus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LABEL_COLORS, PRIORITY_LABEL, PRIORITY_ORDER, PROGRESS_LABEL, PROGRESS_ORDER, TASK_LIMITS } from '../../../shared/tasks'
import type { Task, TaskBoard, TaskCheckItem, TaskComment, TaskLabel, TaskPatch, TaskPriority, TaskProgress } from '../../../shared/types'
import { errorMessage, setPending, wiki } from '../api'
import { Modal } from '../dialogs/Modal'
import { useWiki } from '../store'
import { pathTo } from '../treeUtils'
import { patchInBoard } from './board'
import { todayString } from './dates'
import { Avatar, LabelChip, PriorityIcon, ProgressIcon, useDismiss } from './parts'
import { copyTask, deleteTask, setProgress } from './TaskCard'

type Popover = 'assign' | 'labels' | 'article' | null

function update(task: Task, patch: TaskPatch): Promise<unknown> {
  return useWiki.getState().taskAct(
    () => wiki.updateTask(task.id, patch),
    (b) => patchInBoard(b, task.id, patch as Partial<Task>)
  )
}

function stamp(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Text, der beim Verlassen des Felds gespeichert wird (und spätestens beim Schließen, Strg+S oder
 * Beenden). Ändert jemand anderes den Wert, während man nicht tippt, erscheint der neue.
 */
function useBufferedText(server: string, save: (value: string) => Promise<unknown>, key: string) {
  const [value, setValue] = useState(server)
  const dirty = useRef(false)
  const latest = useRef(server)
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    if (!dirty.current) {
      setValue(server)
      latest.current = server
    }
  }, [server])

  const commit = useCallback(async () => {
    if (!dirty.current) return
    dirty.current = false
    setPending(key, null)
    await saveRef.current(latest.current)
  }, [key])

  const change = (next: string): void => {
    setValue(next)
    latest.current = next
    dirty.current = true
    setPending(key, commit)
  }
  const reset = (): void => {
    dirty.current = false
    setPending(key, null)
    setValue(server)
    latest.current = server
  }
  // Beim Schließen des Dialogs nichts verlieren
  useEffect(() => () => void commit(), [commit])
  return { value, change, commit, reset }
}

// ---------- Titel ----------

function TitleField({ task, focus }: { task: Task; focus: boolean }): React.JSX.Element {
  const input = useRef<HTMLTextAreaElement>(null)
  const field = useBufferedText(
    task.title,
    (v) => (v.trim() ? update(task, { title: v }) : Promise.resolve()),
    `task-title-${task.id}`
  )
  useEffect(() => {
    if (focus) {
      input.current?.focus()
      input.current?.select()
    }
  }, [focus])
  return (
    <textarea
      ref={input}
      className="td-title"
      rows={1}
      value={field.value}
      maxLength={TASK_LIMITS.title}
      aria-label="Titel der Aufgabe"
      onChange={(e) => field.change(e.target.value.replace(/\n/g, ' '))}
      onBlur={() => {
        if (!field.value.trim()) field.reset()
        else void field.commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLTextAreaElement).blur()
        }
      }}
    />
  )
}

// ---------- Zuweisen ----------

function AssignPicker({ task, board, onClose }: { task: Task; board: TaskBoard; onClose(): void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  useDismiss(true, ref, onClose, false)
  const users = board.users.filter((u) => !u.deleted && u.username.toLowerCase().includes(query.trim().toLowerCase()))
  const assigned = (name: string): boolean => task.assignees.some((a) => a.toLowerCase() === name.toLowerCase())
  const toggle = (name: string): void => {
    const next = assigned(name) ? task.assignees.filter((a) => a.toLowerCase() !== name.toLowerCase()) : [...task.assignees, name]
    void useWiki.getState().taskAct(
      () => wiki.setTaskAssignees(task.id, next),
      (b) => patchInBoard(b, task.id, { assignees: next })
    )
  }
  return (
    <div ref={ref} className="td-popover" role="dialog" aria-label="Zuweisen">
      <input autoFocus value={query} placeholder="Name suchen" aria-label="Name suchen" onChange={(e) => setQuery(e.target.value)} />
      <div className="td-popover-list">
        {users.map((u) => (
          <button key={u.username} className={assigned(u.username) ? 'checked' : ''} onClick={() => toggle(u.username)}>
            <Avatar name={u.username} size={22} />
            <span>{u.username}</span>
            {assigned(u.username) && <Check size={15} />}
          </button>
        ))}
        {users.length === 0 && <p className="muted small pad">Niemand gefunden.</p>}
      </div>
    </div>
  )
}

// ---------- Bezeichnungen ----------

function ColorSwatches({ value, onPick }: { value: string; onPick(color: string): void }): React.JSX.Element {
  return (
    <div className="td-swatches" role="radiogroup" aria-label="Farbe">
      {LABEL_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          className={`swatch ${value === c.id ? 'active' : ''}`}
          style={{ background: c.hex }}
          title={c.name}
          onClick={() => onPick(c.id)}
        />
      ))}
    </div>
  )
}

function LabelRow({ label, active, onToggle }: { label: TaskLabel; active: boolean; onToggle(): void }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(label.name)
  const [color, setColor] = useState(label.color)
  const s = useWiki.getState()
  if (editing) {
    return (
      <form
        className="td-label-edit"
        onSubmit={(e) => {
          e.preventDefault()
          setEditing(false)
          if (name.trim() && (name.trim() !== label.name || color !== label.color)) {
            void s.taskAct(() => wiki.updateTaskLabel(label.id, name, color))
          }
        }}
      >
        <input autoFocus value={name} maxLength={TASK_LIMITS.label} aria-label="Name der Bezeichnung" onChange={(e) => setName(e.target.value)} />
        <ColorSwatches value={color} onPick={setColor} />
        <div className="row-end">
          <button type="button" className="btn btn-small" onClick={() => setEditing(false)}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn-small btn-primary">
            Speichern
          </button>
        </div>
      </form>
    )
  }
  const remove = async (): Promise<void> => {
    const used = s.board?.tasks.filter((t) => t.labelIds.includes(label.id)).length ?? 0
    const ok = await s.confirm({
      title: 'Bezeichnung löschen?',
      message:
        used > 0
          ? `„${label.name}“ verschwindet von ${used === 1 ? 'einer Aufgabe' : `${used} Aufgaben`}. Die Aufgaben selbst bleiben.`
          : `„${label.name}“ wird gelöscht.`,
      confirmLabel: 'Löschen',
      danger: true
    })
    if (ok) await s.taskAct(() => wiki.deleteTaskLabel(label.id))
  }
  return (
    <div className={`td-label-row ${active ? 'checked' : ''}`}>
      <button className="td-label-toggle" aria-pressed={active} onClick={onToggle}>
        <LabelChip label={label} />
        {active && <Check size={15} />}
      </button>
      <button className="icon-btn small" title="Bearbeiten" onClick={() => setEditing(true)}>
        <Pencil size={13} />
      </button>
      <button className="icon-btn small danger" title="Bezeichnung löschen" onClick={() => void remove()}>
        <Trash2 size={13} />
      </button>
    </div>
  )
}

function LabelPicker({ task, board, onClose }: { task: Task; board: TaskBoard; onClose(): void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [name, setName] = useState('')
  const used = new Set(board.labels.map((l) => l.color))
  const [color, setColor] = useState<string>(LABEL_COLORS.find((c) => !used.has(c.id))?.id ?? 'blue')
  useDismiss(true, ref, onClose, false)
  const s = useWiki.getState()
  const setLabels = (ids: number[]): void => {
    void s.taskAct(
      () => wiki.setTaskLabels(task.id, ids),
      (b) => patchInBoard(b, task.id, { labelIds: ids })
    )
  }
  const create = async (): Promise<void> => {
    const text = name.trim()
    if (!text) return
    const id = await s.taskAct(() => wiki.createTaskLabel(text, color))
    if (id == null) return
    setName('')
    setLabels([...task.labelIds, id])
  }
  return (
    <div ref={ref} className="td-popover wide" role="dialog" aria-label="Bezeichnungen">
      <div className="td-popover-list">
        {board.labels.map((l) => (
          <LabelRow
            key={`${l.id}-${l.name}-${l.color}`}
            label={l}
            active={task.labelIds.includes(l.id)}
            onToggle={() =>
              setLabels(task.labelIds.includes(l.id) ? task.labelIds.filter((x) => x !== l.id) : [...task.labelIds, l.id])
            }
          />
        ))}
        {board.labels.length === 0 && <p className="muted small pad">Noch keine Bezeichnungen. Sie gelten für alle Aufgaben.</p>}
      </div>
      <form
        className="td-label-new"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <input
          value={name}
          maxLength={TASK_LIMITS.label}
          placeholder="Neue Bezeichnung, z. B. „Server“"
          aria-label="Neue Bezeichnung"
          onChange={(e) => setName(e.target.value)}
        />
        <ColorSwatches value={color} onPick={setColor} />
        <div className="row-end">
          <button type="submit" className="btn btn-small btn-primary" disabled={!name.trim()}>
            <Plus size={14} /> Anlegen
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------- Artikel ----------

function ArticlePicker({ task, onClose }: { task: Task; onClose(): void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const tree = useWiki((s) => s.tree)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  useDismiss(true, ref, onClose, false)
  const hits = useMemo(() => {
    if (!tree) return []
    const tokens = query.toLocaleLowerCase('de').split(/\s+/).filter(Boolean)
    return tree.articles
      .filter((a) => tokens.every((t) => a.title.toLocaleLowerCase('de').includes(t)))
      .slice(0, 8)
      .map((a) => ({
        id: a.id,
        title: a.title,
        path: pathTo(tree, a.id)
          .slice(0, -1)
          .map((p) => p.title)
          .join(' › ')
      }))
  }, [tree, query])
  const pick = (id: number): void => {
    onClose()
    void update(task, { articleId: id })
  }
  return (
    <div ref={ref} className="td-popover wide" role="dialog" aria-label="Artikel verknüpfen">
      <input
        autoFocus
        value={query}
        placeholder="Artikel suchen"
        aria-label="Artikel suchen"
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, hits.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && hits[active]) {
            e.preventDefault()
            pick(hits[active].id)
          }
        }}
      />
      <div className="td-popover-list">
        {hits.map((h, i) => (
          <button key={h.id} className={`td-article-hit ${i === active ? 'active' : ''}`} onClick={() => pick(h.id)}>
            <FileText size={14} />
            <span>
              {h.title}
              {h.path && <small>{h.path}</small>}
            </span>
          </button>
        ))}
        {hits.length === 0 && <p className="muted small pad">Kein Artikel gefunden.</p>}
      </div>
    </div>
  )
}

// ---------- Checkliste ----------

function CheckRow({ task, item, index, count }: { task: Task; item: TaskCheckItem; index: number; count: number }): React.JSX.Element {
  const s = useWiki.getState()
  const field = useBufferedText(
    item.text,
    (v) => s.taskAct(() => wiki.updateTaskCheckItem(item.id, v)),
    `task-check-${item.id}`
  )
  const setChecklist = (fn: (list: TaskCheckItem[]) => TaskCheckItem[]) => (b: TaskBoard) =>
    patchInBoard(b, task.id, { checklist: fn(task.checklist) })
  const remove = (): void => {
    field.reset()
    void s.taskAct(
      () => wiki.deleteTaskCheckItem(item.id),
      setChecklist((l) => l.filter((c) => c.id !== item.id))
    )
  }
  return (
    <li className={`td-check ${item.checked ? 'checked' : ''}`}>
      <input
        type="checkbox"
        checked={item.checked}
        aria-label={`${item.text} erledigt`}
        onChange={(e) => {
          const checked = e.target.checked
          void s.taskAct(
            () => wiki.setTaskCheckItemChecked(item.id, checked),
            setChecklist((l) => l.map((c) => (c.id === item.id ? { ...c, checked } : c)))
          )
        }}
      />
      <input
        className="td-check-text"
        value={field.value}
        maxLength={TASK_LIMITS.checkItem}
        aria-label={`Punkt ${index + 1}`}
        onChange={(e) => field.change(e.target.value)}
        onBlur={() => {
          if (!field.value.trim()) field.reset()
          else void field.commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          else if (e.key === 'Backspace' && field.value === '') {
            e.preventDefault()
            remove()
          }
        }}
      />
      <span className="td-check-actions">
        <button title="Nach oben" disabled={index === 0} onClick={() => void s.taskAct(() => wiki.moveTaskCheckItem(item.id, -1))}>
          <ArrowUp size={13} />
        </button>
        <button
          title="Nach unten"
          disabled={index === count - 1}
          onClick={() => void s.taskAct(() => wiki.moveTaskCheckItem(item.id, 1))}
        >
          <ArrowDown size={13} />
        </button>
        <button title="Punkt löschen" onClick={remove}>
          <X size={13} />
        </button>
      </span>
    </li>
  )
}

function Checklist({ task }: { task: Task }): React.JSX.Element {
  const [text, setText] = useState('')
  const add = async (): Promise<void> => {
    const value = text.trim()
    if (!value) return
    setText('')
    await useWiki.getState().taskAct(() => wiki.addTaskCheckItem(task.id, value))
  }
  return (
    <>
      {task.checklist.length > 0 && (
        <ul className="td-checklist">
          {task.checklist.map((item, i) => (
            <CheckRow key={item.id} task={task} item={item} index={i} count={task.checklist.length} />
          ))}
        </ul>
      )}
      <div className="td-check-add">
        <Plus size={15} />
        <input
          value={text}
          maxLength={TASK_LIMITS.checkItem}
          placeholder="Element hinzufügen"
          aria-label="Element zur Checkliste hinzufügen"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void add()
            }
          }}
        />
      </div>
    </>
  )
}

// ---------- Kommentare ----------

function Comments({ task }: { task: Task }): React.JSX.Element {
  const [comments, setComments] = useState<TaskComment[] | null>(null)
  const [text, setText] = useState('')
  const userName = useWiki((s) => s.userName)
  const s = useWiki.getState()

  const load = useCallback(() => {
    wiki
      .getTaskComments(task.id)
      .then(setComments)
      .catch((err) => useWiki.getState().toast(errorMessage(err), 'error'))
  }, [task.id])
  // Neu laden, wenn jemand (auch auf einem anderen Rechner) kommentiert hat
  useEffect(load, [load, task.commentCount])

  const send = async (): Promise<void> => {
    const value = text.trim()
    if (!value) return
    const id = await s.taskAct(() => wiki.addTaskComment(task.id, value))
    if (id != null) {
      setText('')
      load()
    }
  }
  const remove = async (c: TaskComment): Promise<void> => {
    const ok = await s.confirm({ title: 'Kommentar löschen?', message: 'Der Kommentar wird endgültig gelöscht.', confirmLabel: 'Löschen', danger: true })
    if (ok) {
      await s.taskAct(() => wiki.deleteTaskComment(c.id))
      load()
    }
  }
  return (
    <>
      <div className="td-comment-new">
        <textarea
          value={text}
          rows={2}
          maxLength={TASK_LIMITS.comment}
          placeholder="Kommentar schreiben (Strg+Enter sendet)"
          aria-label="Neuer Kommentar"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button className="btn btn-small btn-primary" disabled={!text.trim()} onClick={() => void send()}>
          <Send size={14} /> Senden
        </button>
      </div>
      {comments && comments.length > 0 && (
        <ul className="td-comments">
          {comments.map((c) => (
            <li key={c.id}>
              <Avatar name={c.author} size={28} />
              <div>
                <div className="td-comment-head">
                  <strong>{c.author}</strong>
                  <span className="muted small">{stamp(c.at)}</span>
                  {c.author.toLowerCase() === userName.toLowerCase() && (
                    <button className="icon-btn small danger" title="Kommentar löschen" onClick={() => void remove(c)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <p>{c.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

// ---------- Dialog ----------

export function TaskDialog({ id }: { id: number }): React.JSX.Element | null {
  const board = useWiki((s) => s.board)
  const fresh = useWiki((s) => s.openTaskFresh)
  const [popover, setPopover] = useState<Popover>(null)
  const closePopover = useCallback(() => setPopover(null), [])
  const task = board?.tasks.find((t) => t.id === id)
  const s = useWiki.getState()

  const close = useCallback(() => {
    // Offene Eingaben (Titel, Notizen …) speichern
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest('.task-modal')) active.blur()
    useWiki.getState().openTask(null)
  }, [])
  const onEscape = useCallback(() => {
    if (!popover) return false
    setPopover(null)
    return true
  }, [popover])

  const notes = useBufferedText(task?.notes ?? '', (v) => (task ? update(task, { notes: v }) : Promise.resolve()), `task-notes-${id}`)

  if (!board) return null
  if (!task) {
    return (
      <Modal title="Aufgabe" onClose={close}>
        <p>Diese Aufgabe gibt es nicht mehr – vielleicht hat sie gerade jemand gelöscht.</p>
      </Modal>
    )
  }

  const done = task.progress === 'done'
  const bucket = board.buckets.find((b) => b.id === task.bucketId)
  const labels = task.labelIds.map((l) => board.labels.find((x) => x.id === l)).filter((l) => l != null)
  const checked = task.checklist.filter((c) => c.checked).length
  const deleted = (name: string): boolean => board.users.find((u) => u.username.toLowerCase() === name.toLowerCase())?.deleted ?? false
  const togglePreview = (kind: 'notes' | 'checklist'): void => void update(task, { preview: task.preview === kind ? null : kind })

  return (
    <Modal
      title={bucket ? `Aufgabe · ${bucket.name}` : 'Aufgabe'}
      onClose={close}
      onEscape={onEscape}
      className="task-modal"
      footer={
        <>
          <span className="td-meta">
            {task.createdBy ? `Erstellt von ${task.createdBy}` : 'Erstellt'} am {stamp(task.createdAt)}
            {done && task.completedAt && (
              <>
                <br />
                Erledigt{task.completedBy ? ` von ${task.completedBy}` : ''} am {stamp(task.completedAt)}
              </>
            )}
          </span>
          <button
            className="btn"
            onClick={async () => {
              const copy = await copyTask(task)
              if (copy != null) s.openTask(copy, true)
            }}
          >
            <Copy size={14} /> Kopieren
          </button>
          <button
            className="btn btn-danger-outline"
            onClick={async () => {
              if (await deleteTask(task)) s.openTask(null)
            }}
          >
            <Trash2 size={14} /> Löschen
          </button>
          <button className="btn btn-primary" onClick={close}>
            Fertig
          </button>
        </>
      }
    >
      <div className={`td ${done ? 'done' : ''}`}>
        <div className="td-title-row">
          <button
            className="task-check big"
            title={done ? 'Als nicht erledigt markieren' : 'Als erledigt markieren'}
            aria-label={done ? 'Als nicht erledigt markieren' : 'Als erledigt markieren'}
            onClick={() => setProgress(task, done ? 'open' : 'done')}
          >
            <ProgressIcon progress={task.progress} size={24} />
          </button>
          <TitleField task={task} focus={fresh} />
        </div>

        <div className="td-line">
          <div className="td-people">
            {task.assignees.map((name) => (
              <span key={name} className={`td-person ${deleted(name) ? 'deleted' : ''}`}>
                <Avatar name={name} deleted={deleted(name)} size={22} />
                {name}
                <button
                  title={`${name} nicht mehr zuweisen`}
                  onClick={() => {
                    const next = task.assignees.filter((a) => a !== name)
                    void s.taskAct(
                      () => wiki.setTaskAssignees(task.id, next),
                      (b) => patchInBoard(b, task.id, { assignees: next })
                    )
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <span className="td-anchor">
              <button className="td-add" aria-expanded={popover === 'assign'} onClick={() => setPopover(popover === 'assign' ? null : 'assign')}>
                <UserPlus size={15} /> Zuweisen
              </button>
              {popover === 'assign' && <AssignPicker task={task} board={board} onClose={closePopover} />}
            </span>
          </div>
        </div>

        <div className="td-line">
          <div className="td-labels">
            {labels.map((l) => (
              <LabelChip
                key={l.id}
                label={l}
                onRemove={() => {
                  const next = task.labelIds.filter((x) => x !== l.id)
                  void s.taskAct(
                    () => wiki.setTaskLabels(task.id, next),
                    (b) => patchInBoard(b, task.id, { labelIds: next })
                  )
                }}
              />
            ))}
            <span className="td-anchor">
              <button className="td-add" aria-expanded={popover === 'labels'} onClick={() => setPopover(popover === 'labels' ? null : 'labels')}>
                <Tag size={15} /> Bezeichnung hinzufügen
              </button>
              {popover === 'labels' && <LabelPicker task={task} board={board} onClose={closePopover} />}
            </span>
          </div>
        </div>

        <div className="td-grid">
          <label>
            <span>Bucket</span>
            <select value={task.bucketId} onChange={(e) => void update(task, { bucketId: Number(e.target.value) })}>
              {board.buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Fortschritt</span>
            <span className="td-select-icon">
              <ProgressIcon progress={task.progress} size={16} />
              <select value={task.progress} onChange={(e) => setProgress(task, e.target.value as TaskProgress)}>
                {PROGRESS_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {PROGRESS_LABEL[p]}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label>
            <span>Priorität</span>
            <span className="td-select-icon">
              <span className="prio-slot">
                <PriorityIcon priority={task.priority} always />
              </span>
              <select value={task.priority} onChange={(e) => void update(task, { priority: e.target.value as TaskPriority })}>
                {PRIORITY_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label>
            <span>Startdatum</span>
            <input
              type="date"
              value={task.startDate ?? ''}
              max={task.dueDate ?? undefined}
              onChange={(e) => void update(task, { startDate: e.target.value || null })}
            />
          </label>
          <label>
            <span>Fälligkeitsdatum</span>
            <input
              type="date"
              value={task.dueDate ?? ''}
              min={task.startDate ?? undefined}
              className={task.dueDate && !done && task.dueDate < todayString() ? 'late' : ''}
              onChange={(e) => void update(task, { dueDate: e.target.value || null })}
            />
          </label>
          <div className="td-field">
            <span>Wiki-Artikel</span>
            <span className="td-anchor">
              {task.articleId != null ? (
                <span className="td-article">
                  <button
                    className={`chip ${task.articleTitle ? '' : 'missing'}`}
                    disabled={!task.articleTitle}
                    title={task.articleTitle ? 'In der Mind Map öffnen' : 'Der Artikel liegt im Papierkorb'}
                    onClick={() => {
                      close()
                      if (task.articleId != null) void s.reveal(task.articleId)
                    }}
                  >
                    <FileText size={13} /> {task.articleTitle ?? 'Im Papierkorb'}
                  </button>
                  <button className="icon-btn small" title="Verknüpfung lösen" onClick={() => void update(task, { articleId: null })}>
                    <X size={13} />
                  </button>
                </span>
              ) : (
                <button className="td-add" aria-expanded={popover === 'article'} onClick={() => setPopover(popover === 'article' ? null : 'article')}>
                  <Link2 size={15} /> Artikel verknüpfen
                </button>
              )}
              {popover === 'article' && <ArticlePicker task={task} onClose={closePopover} />}
            </span>
          </div>
        </div>

        <section className="td-section">
          <div className="td-section-head">
            <h3>Notizen</h3>
            <label className="td-preview">
              <input type="checkbox" checked={task.preview === 'notes'} onChange={() => togglePreview('notes')} /> Auf Karte anzeigen
            </label>
          </div>
          <textarea
            className="td-notes"
            value={notes.value}
            maxLength={TASK_LIMITS.notes}
            placeholder="Beschreibung oder Notiz hinzufügen"
            aria-label="Notizen"
            onChange={(e) => notes.change(e.target.value)}
            onBlur={() => void notes.commit()}
          />
        </section>

        <section className="td-section">
          <div className="td-section-head">
            <h3>
              Checkliste{' '}
              {task.checklist.length > 0 && (
                <span className="muted">
                  {checked}/{task.checklist.length}
                </span>
              )}
            </h3>
            <label className="td-preview">
              <input type="checkbox" checked={task.preview === 'checklist'} onChange={() => togglePreview('checklist')} /> Auf Karte anzeigen
            </label>
          </div>
          <Checklist task={task} />
        </section>

        <section className="td-section">
          <div className="td-section-head">
            <h3>Kommentare</h3>
          </div>
          <Comments task={task} />
        </section>
      </div>
    </Modal>
  )
}
