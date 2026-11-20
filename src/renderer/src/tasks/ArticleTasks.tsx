import { Plus } from 'lucide-react'
import { useState } from 'react'
import { TASK_LIMITS } from '../../../shared/tasks'
import { wiki } from '../api'
import { useWiki } from '../store'
import { todayString } from './dates'
import { Avatars, DueChip, ProgressIcon } from './parts'
import { useTaskMenu } from './TaskMenu'

/** Im Artikel: Aufgaben, die mit ihm verknüpft sind, und neue anlegen. */
export function ArticleTasks({ articleId }: { articleId: number }): React.JSX.Element | null {
  const board = useWiki((s) => s.board)
  const [title, setTitle] = useState('')
  const { menu, menuTaskId, onContextMenu } = useTaskMenu()
  if (!board) return null
  const today = todayString()
  const tasks = board.tasks
    .filter((t) => t.articleId === articleId)
    .sort((a, b) => Number(a.progress === 'done') - Number(b.progress === 'done') || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'))
  const open = tasks.filter((t) => t.progress !== 'done').length

  const add = async (): Promise<void> => {
    const text = title.trim()
    if (!text) return
    setTitle('')
    const s = useWiki.getState()
    const id = await s.taskAct(() => wiki.createTask(null, text, { articleId }))
    if (id != null) s.toast('Aufgabe angelegt – zu sehen im Reiter „Aufgaben“.')
  }

  return (
    <section className="panel-section article-tasks">
      <div className="section-head">
        <h3>
          Aufgaben {tasks.length > 0 && <span className="muted">{open} offen</span>}
        </h3>
      </div>
      {tasks.length > 0 && (
        <ul className="article-task-list">
          {tasks.map((t) => (
            <li key={t.id} className={`${t.progress === 'done' ? 'done' : ''} ${menuTaskId === t.id ? 'menu-open' : ''}`}>
              <button onClick={() => useWiki.getState().openTask(t.id)} onContextMenu={onContextMenu(t.id)}>
                <ProgressIcon progress={t.progress} size={16} />
                <span className="article-task-title">{t.title}</span>
                <DueChip task={t} today={today} />
                <Avatars names={t.assignees} users={board.users} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="td-check-add"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <Plus size={15} />
        <input
          value={title}
          maxLength={TASK_LIMITS.title}
          placeholder="Neue Aufgabe zu diesem Artikel"
          aria-label="Neue Aufgabe zu diesem Artikel"
          onChange={(e) => setTitle(e.target.value)}
        />
      </form>
      {menu}
    </section>
  )
}
