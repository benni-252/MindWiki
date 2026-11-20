import { ArrowDown, ArrowUp, FileText, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PRIORITY_LABEL, PRIORITY_ORDER, PROGRESS_LABEL, PROGRESS_ORDER, TASK_LIMITS } from '../../../shared/tasks'
import type { Task, TaskBoard, TaskPriority, TaskProgress } from '../../../shared/types'
import { wiki } from '../api'
import { useWiki } from '../store'
import { sortTasks, type SortKey } from './board'
import { Avatars, DueChip, LabelChip, PriorityIcon, ProgressIcon } from './parts'
import { setPriority, setProgress } from './taskActions'
import { useTaskMenu } from './TaskMenu'

const COLUMNS: { key: SortKey; title: string }[] = [
  { key: 'title', title: 'Aufgabe' },
  { key: 'assignees', title: 'Zugewiesen an' },
  { key: 'progress', title: 'Fortschritt' },
  { key: 'due', title: 'Fällig' },
  { key: 'priority', title: 'Priorität' },
  { key: 'bucket', title: 'Bucket' },
  { key: 'labels', title: 'Bezeichnungen' }
]

function AddRow(): React.JSX.Element {
  const [title, setTitle] = useState('')
  const submit = async (): Promise<void> => {
    const text = title.trim()
    if (!text) return
    setTitle('')
    await useWiki.getState().taskAct(() => wiki.createTask(null, text))
  }
  return (
    <form
      className="task-list-add"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Plus size={15} />
      <input
        value={title}
        maxLength={TASK_LIMITS.title}
        placeholder="Aufgabe hinzufügen – Enter legt sie im ersten Bucket an"
        aria-label="Neue Aufgabe"
        onChange={(e) => setTitle(e.target.value)}
      />
    </form>
  )
}

export function TaskList({
  board,
  tasks,
  today,
  filtered
}: {
  board: TaskBoard
  tasks: Task[]
  today: string
  filtered: boolean
}): React.JSX.Element {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'bucket', desc: false })
  const { menu, menuTaskId, onContextMenu } = useTaskMenu()
  const rows = useMemo(() => sortTasks(tasks, board, sort.key, sort.desc), [tasks, board, sort])
  const s = useWiki.getState()
  const bucketName = (id: number): string => board.buckets.find((b) => b.id === id)?.name ?? ''

  return (
    <div className="task-list-wrap">
      <AddRow />
      <table className="task-list">
        <thead>
          <tr>
            <th className="tl-check" aria-label="Erledigt" />
            {COLUMNS.map((c) => (
              <th key={c.key} aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
                <button onClick={() => setSort((p) => ({ key: c.key, desc: p.key === c.key ? !p.desc : false }))}>
                  {c.title}
                  {sort.key === c.key && (sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const done = t.progress === 'done'
            return (
              <tr
                key={t.id}
                className={`${done ? 'done' : ''} ${menuTaskId === t.id ? 'menu-open' : ''}`}
                onClick={() => s.openTask(t.id)}
                onContextMenu={onContextMenu(t.id)}
              >
                <td className="tl-check">
                  <button
                    className="task-check"
                    title={done ? 'Als nicht erledigt markieren' : 'Als erledigt markieren'}
                    aria-label={done ? 'Als nicht erledigt markieren' : 'Als erledigt markieren'}
                    onClick={(e) => {
                      e.stopPropagation()
                      setProgress(t, done ? 'open' : 'done')
                    }}
                  >
                    <ProgressIcon progress={t.progress} />
                  </button>
                </td>
                <td className="tl-title">
                  <span>{t.title}</span>
                  {t.articleTitle && (
                    <span className="tl-article" title={`Verknüpft mit „${t.articleTitle}“`}>
                      <FileText size={12} /> {t.articleTitle}
                    </span>
                  )}
                </td>
                <td>
                  <Avatars names={t.assignees} users={board.users} max={4} />
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <select
                    className="tl-select"
                    value={t.progress}
                    aria-label="Fortschritt"
                    onChange={(e) => setProgress(t, e.target.value as TaskProgress)}
                  >
                    {PROGRESS_ORDER.map((p) => (
                      <option key={p} value={p}>
                        {PROGRESS_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <DueChip task={t} today={today} />
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <span className="tl-prio">
                    <span className="prio-slot">
                      <PriorityIcon priority={t.priority} always />
                    </span>
                    <select
                      className="tl-select"
                      value={t.priority}
                      aria-label="Priorität"
                      onChange={(e) => setPriority(t, e.target.value as TaskPriority)}
                    >
                      {PRIORITY_ORDER.map((p) => (
                        <option key={p} value={p}>
                          {PRIORITY_LABEL[p]}
                        </option>
                      ))}
                    </select>
                  </span>
                </td>
                <td className="tl-bucket">{bucketName(t.bucketId)}</td>
                <td>
                  <span className="tl-labels">
                    {t.labelIds.map((id) => {
                      const label = board.labels.find((l) => l.id === id)
                      return label ? <LabelChip key={id} label={label} /> : null
                    })}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="task-list-empty muted">{filtered ? 'Keine Aufgabe passt zum Filter.' : 'Noch keine Aufgaben.'}</p>
      )}
      {menu}
    </div>
  )
}
