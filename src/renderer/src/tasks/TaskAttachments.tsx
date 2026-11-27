import { Download, ExternalLink, Paperclip, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { formatBytes } from '../../../shared/attachments'
import type { Task, TaskAttachment } from '../../../shared/types'
import { errorMessage, wiki } from '../api'
import { FileIcon, hasFiles } from '../article/Attachments'
import { useWiki } from '../store'
import { formatWhen } from '../treeUtils'
import { attachFilesToTask, pickTaskAttachments } from './taskActions'

/** Anhänge in den Details einer Aufgabe: anhängen (Knopf oder aus dem Explorer ziehen), öffnen, speichern, entfernen. */
export function TaskAttachments({ task }: { task: Task }): React.JSX.Element {
  const [items, setItems] = useState<TaskAttachment[] | null>(null)
  const [dragging, setDragging] = useState(false)
  const s = useWiki.getState()
  const fail = (err: unknown): void => useWiki.getState().toast(errorMessage(err), 'error')

  const load = useCallback(() => {
    wiki
      .getTaskAttachments(task.id)
      .then(setItems)
      .catch((err) => useWiki.getState().toast(errorMessage(err), 'error'))
  }, [task.id])
  // Neu laden, wenn sich die Zahl ändert – auch durch andere Rechner oder eine auf die Karte gezogene Datei
  useEffect(load, [load, task.attachmentCount])

  const pick = (): void => void pickTaskAttachments(task.id)
  const open = (a: TaskAttachment): void => void wiki.openTaskAttachment(a.id).catch(fail)
  const saveAs = async (a: TaskAttachment): Promise<void> => {
    try {
      const file = await wiki.saveTaskAttachmentAs(a.id)
      if (file) s.toast(`Gespeichert: ${file}`)
    } catch (err) {
      fail(err)
    }
  }
  const remove = async (a: TaskAttachment): Promise<void> => {
    const ok = await s.confirm({
      title: 'Anhang entfernen?',
      message: `„${a.name}“ wird aus der Aufgabe entfernt.`,
      confirmLabel: 'Entfernen',
      danger: true
    })
    if (!ok) return
    await s.taskAct(() => wiki.deleteTaskAttachment(a.id))
    load()
  }

  const onDragOver = (e: DragEvent<HTMLElement>): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }
  const onDrop = (e: DragEvent<HTMLElement>): void => {
    setDragging(false)
    if (!hasFiles(e)) return
    e.preventDefault()
    const files = [...e.dataTransfer.files]
    if (files.length > 0) void attachFilesToTask(task.id, files)
  }

  return (
    <section
      className={`td-section attachments ${dragging ? 'dragging' : ''}`}
      aria-label="Anhänge"
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="td-section-head">
        <h3>
          Anhänge {items && items.length > 0 && <span className="muted">{items.length}</span>}
        </h3>
        <button className="btn btn-small" onClick={pick}>
          <Paperclip size={14} /> Datei anhängen…
        </button>
      </div>
      {items && items.length === 0 && (
        <button className="att-empty" onClick={pick}>
          <Paperclip size={15} /> Dateien anhängen (PDF, Word, Excel, Bilder …) – oder aus dem Explorer hierher ziehen
        </button>
      )}
      {items && items.length > 0 && (
        <ul className="att-list">
          {items.map((a) => (
            <li key={a.id}>
              <span className="att-icon">
                <FileIcon name={a.name} />
              </span>
              <span className="att-main">
                <button className="att-name" title="Öffnen" onClick={() => open(a)}>
                  {a.name}
                </button>
                <span className="att-meta">
                  {formatBytes(a.size)} · {a.addedBy ?? 'unbekannt'}, {formatWhen(a.addedAt)}
                </span>
              </span>
              <span className="att-actions">
                <button className="icon-btn" title="Öffnen" aria-label={`${a.name} öffnen`} onClick={() => open(a)}>
                  <ExternalLink size={16} />
                </button>
                <button
                  className="icon-btn"
                  title="Speichern unter…"
                  aria-label={`${a.name} speichern unter`}
                  onClick={() => void saveAs(a)}
                >
                  <Download size={16} />
                </button>
                <button
                  className="icon-btn danger"
                  title="Entfernen"
                  aria-label={`${a.name} entfernen`}
                  onClick={() => void remove(a)}
                >
                  <Trash2 size={16} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {dragging && <div className="att-drop">Loslassen zum Anhängen</div>}
    </section>
  )
}
