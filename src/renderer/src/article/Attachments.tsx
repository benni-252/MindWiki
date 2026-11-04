import {
  Download,
  ExternalLink,
  File as FileGeneric,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Paperclip,
  Trash2
} from 'lucide-react'
import { useEffect, useState, type DragEvent } from 'react'
import { extensionOf, formatBytes } from '../../../shared/attachments'
import type { Attachment } from '../../../shared/types'
import { errorMessage, wiki } from '../api'
import { useWiki } from '../store'
import { formatWhen } from '../treeUtils'

function FileIcon({ name }: { name: string }): React.JSX.Element {
  const ext = extensionOf(name)
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return <FileSpreadsheet size={18} />
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) return <FileImage size={18} />
  if (['zip', '7z', 'rar', 'gz', 'tar'].includes(ext)) return <FileArchive size={18} />
  if (['pdf', 'doc', 'docx', 'odt', 'txt', 'md', 'rtf', 'log'].includes(ext)) return <FileText size={18} />
  return <FileGeneric size={18} />
}

/** Zieht jemand Dateien (nicht Text) über den Bereich? */
const hasFiles = (e: DragEvent): boolean => [...e.dataTransfer.types].includes('Files')

/** Angehängte Dokumente: öffnen, speichern, anhängen (Knopf oder Ziehen aus dem Explorer), entfernen. */
export function Attachments({ articleId, readOnly }: { articleId: number; readOnly: boolean }): React.JSX.Element | null {
  const version = useWiki((s) => s.attachmentsVersion)
  const [items, setItems] = useState<Attachment[] | null>(null)
  const [dragging, setDragging] = useState(false)
  const s = useWiki.getState()
  const fail = (err: unknown): void => s.toast(errorMessage(err), 'error')

  useEffect(() => {
    let alive = true
    wiki
      .getAttachments(articleId)
      .then((list) => alive && setItems(list))
      .catch((err) => alive && fail(err))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId, version])

  if (!items || (readOnly && items.length === 0)) return null

  const pick = (): void => void s.pickAttachments(articleId)
  const open = (a: Attachment): void => void wiki.openAttachment(a.id).catch(fail)
  const saveAs = async (a: Attachment): Promise<void> => {
    try {
      const file = await wiki.saveAttachmentAs(a.id)
      if (file) s.toast(`Gespeichert: ${file}`)
    } catch (err) {
      fail(err)
    }
  }
  const remove = async (a: Attachment): Promise<void> => {
    const ok = await s.confirm({
      title: 'Anhang entfernen?',
      message: `„${a.name}“ wird aus dem Artikel entfernt. Im Verlauf bleibt vermerkt, dass es den Anhang gab – die Datei selbst ist danach weg.`,
      confirmLabel: 'Entfernen',
      danger: true
    })
    if (ok) await s.deleteAttachment(a.id)
  }

  const onDragOver = (e: DragEvent<HTMLElement>): void => {
    if (readOnly || !hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }
  const onDrop = (e: DragEvent<HTMLElement>): void => {
    setDragging(false)
    if (readOnly || !hasFiles(e)) return
    e.preventDefault()
    const files = [...e.dataTransfer.files]
    if (files.length > 0) void s.attachFiles(articleId, files)
  }

  return (
    <section
      className={`panel-section attachments ${dragging ? 'dragging' : ''}`}
      aria-label="Anhänge"
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="section-head">
        <h3>Anhänge</h3>
        {!readOnly && (
          <button className="btn btn-small" onClick={pick}>
            <Paperclip size={14} /> Datei anhängen…
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <button className="att-empty" onClick={pick}>
          <Paperclip size={15} /> Dokumente anhängen (PDF, Word, Excel …) – oder aus dem Explorer hierher ziehen
        </button>
      ) : (
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
                {!readOnly && (
                  <button
                    className="icon-btn danger"
                    title="Entfernen"
                    aria-label={`${a.name} entfernen`}
                    onClick={() => void remove(a)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <p className="muted small att-hint">
          Geöffnet wird eine schreibgeschützte Kopie. Zum Ändern: speichern, bearbeiten und die neue Fassung anhängen.
          {!readOnly && ' Weitere Dateien kannst du auch hierher ziehen.'}
        </p>
      )}
      {dragging && <div className="att-drop">Loslassen zum Anhängen</div>}
    </section>
  )
}
