import { History as HistoryIcon, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ChangeEntry } from '../../../shared/types'
import { errorMessage, flushPending, wiki } from '../api'
import { Modal } from '../dialogs/Modal'
import { useWiki } from '../store'
import { formatWhen, indexTree } from '../treeUtils'
import { TextViewer } from './Editor'

const SHOWN = 6

/** Text, wie er vor einer Änderung war – ansehen und bei Bedarf zurückholen. */
function VersionDialog({ articleId, change, onClose }: { articleId: number; change: ChangeEntry; onClose(): void }): React.JSX.Element {
  const [content, setContent] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    wiki
      .getTextVersion(change.id)
      .then(setContent)
      .catch(() => setContent(null))
  }, [change.id])

  const restore = async (): Promise<void> => {
    const s = useWiki.getState()
    const ok = await s.confirm({
      title: 'Diese Fassung wiederherstellen?',
      message: 'Der aktuelle Text wird ersetzt. Er bleibt im Verlauf erhalten und lässt sich ebenso zurückholen.',
      confirmLabel: 'Wiederherstellen'
    })
    if (!ok) return
    try {
      await flushPending()
      await wiki.restoreTextVersion(change.id)
      onClose()
      await s.loadTree()
      s.reloadArticle()
      s.toast('Frühere Fassung wiederhergestellt.')
    } catch (err) {
      s.toast(errorMessage(err), 'error')
    }
  }

  return (
    <Modal
      title="Text vor dieser Änderung"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Schließen
          </button>
          <button className="btn btn-primary" disabled={!content} onClick={() => void restore()}>
            <RotateCcw size={14} /> Diese Fassung wiederherstellen
          </button>
        </>
      }
    >
      <p className="muted small">
        So sah der Text aus, bevor {change.author} ihn {formatWhen(change.at)} geändert hat.
      </p>
      {content === undefined && <p className="muted">Lade …</p>}
      {content === null && <p className="muted">Diese Fassung ist nicht mehr gespeichert.</p>}
      {content && <TextViewer articleId={articleId} content={content} />}
    </Modal>
  )
}

/** Verlauf eines Artikels: wer hat wann was geändert. Einträge seit `newSince` von anderen sind markiert. */
export function History({ id, newSince }: { id: number; newSince: string | null }): React.JSX.Element | null {
  const lastChangeAt = useWiki((s) => (s.tree ? indexTree(s.tree).byId.get(id)?.lastChangeAt : null))
  const version = useWiki((s) => s.articleVersion)
  const userName = useWiki((s) => s.userName)
  const [entries, setEntries] = useState<ChangeEntry[] | null>(null)
  const [all, setAll] = useState(false)
  const [viewing, setViewing] = useState<ChangeEntry | null>(null)

  useEffect(() => setAll(false), [id])
  useEffect(() => {
    let alive = true
    wiki
      .getChanges(id)
      .then((list) => alive && setEntries(list))
      .catch((err) => useWiki.getState().toast(errorMessage(err), 'error'))
    return () => {
      alive = false
    }
  }, [id, version, lastChangeAt])

  if (!entries || entries.length === 0) return null
  const shown = all ? entries : entries.slice(0, SHOWN)
  const isNew = (c: ChangeEntry): boolean => newSince != null && c.author !== userName && c.at > newSince

  return (
    <section className="panel-section history" aria-label="Verlauf">
      <h3>
        <HistoryIcon size={14} /> Verlauf
      </h3>
      <ol className="history-list">
        {shown.map((c) => (
          <li key={c.id} className={isNew(c) ? 'unseen' : ''}>
            <div className="history-meta">
              <strong>{c.author}</strong>
              <time dateTime={c.at} title={new Date(c.at).toLocaleString('de-DE')}>
                {formatWhen(c.at)}
              </time>
              {isNew(c) && <span className="new-tag">neu</span>}
            </div>
            <div className="history-summary">{c.summary}</div>
            {c.hasVersion && (
              <button className="link-btn" onClick={() => setViewing(c)}>
                Text davor ansehen
              </button>
            )}
          </li>
        ))}
      </ol>
      {entries.length > shown.length && (
        <button className="link-btn" onClick={() => setAll(true)}>
          Alle {entries.length} Einträge zeigen
        </button>
      )}
      {viewing && <VersionDialog articleId={id} change={viewing} onClose={() => setViewing(null)} />}
    </section>
  )
}
