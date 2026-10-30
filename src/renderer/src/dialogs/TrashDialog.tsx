import { RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { TrashEntry } from '../../../shared/types'
import { errorMessage, wiki } from '../api'
import { useWiki } from '../store'
import { Modal } from './Modal'

export function TrashDialog(): React.JSX.Element {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null)
  const close = useCallback(() => useWiki.getState().setDialog(null), [])

  const reload = useCallback(async () => {
    try {
      setEntries(await wiki.listTrash())
    } catch (err) {
      useWiki.getState().toast(errorMessage(err), 'error')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
      await reload()
      await useWiki.getState().loadTree()
    } catch (err) {
      useWiki.getState().toast(errorMessage(err), 'error')
    }
  }

  const restore = async (entry: TrashEntry): Promise<void> => {
    await run(() => wiki.restoreArticle(entry.id))
    useWiki.getState().select(entry.id, 'flash')
    useWiki.getState().toast(`„${entry.title}“ wiederhergestellt.`)
  }

  const purge = async (entry: TrashEntry): Promise<void> => {
    const ok = await useWiki.getState().confirm({
      title: 'Endgültig löschen?',
      message: `„${entry.title}“${entry.count > 1 ? ` und ${entry.count - 1} Unterartikel` : ''} werden samt Abläufen und Bildern unwiderruflich gelöscht.`,
      confirmLabel: 'Endgültig löschen',
      danger: true
    })
    if (ok) await run(() => wiki.purgeArticle(entry.id))
  }

  const empty = async (): Promise<void> => {
    const ok = await useWiki.getState().confirm({
      title: 'Papierkorb leeren?',
      message: 'Alle Artikel im Papierkorb werden unwiderruflich gelöscht.',
      confirmLabel: 'Papierkorb leeren',
      danger: true
    })
    if (ok) await run(() => wiki.emptyTrash())
  }

  return (
    <Modal
      title="Papierkorb"
      onClose={close}
      wide
      footer={
        <>
          <button className="btn btn-danger" disabled={!entries?.length} onClick={() => void empty()}>
            Papierkorb leeren
          </button>
          <button className="btn btn-primary" onClick={close}>
            Fertig
          </button>
        </>
      }
    >
      {entries === null && <p className="muted">Lade …</p>}
      {entries?.length === 0 && <p className="muted">Der Papierkorb ist leer.</p>}
      {entries && entries.length > 0 && (
        <ul className="trash-list">
          {entries.map((e) => (
            <li key={e.id}>
              <div>
                <strong>{e.title}</strong>
                <small>
                  gelöscht {new Date(e.deletedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}
                  {e.count > 1 && ` · mit ${e.count - 1} Unterartikel${e.count > 2 ? 'n' : ''}`}
                </small>
              </div>
              <button className="btn btn-small" onClick={() => void restore(e)}>
                <RotateCcw size={14} /> Wiederherstellen
              </button>
              <button className="icon-btn small danger" title="Endgültig löschen" onClick={() => void purge(e)}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
