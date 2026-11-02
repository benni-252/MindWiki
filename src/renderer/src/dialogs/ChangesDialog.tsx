import { PenLine } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { RecentChange } from '../../../shared/types'
import { errorMessage, wiki } from '../api'
import { useWiki } from '../store'
import { formatWhen, seenAt, unseenArticles } from '../treeUtils'
import { Modal } from './Modal'

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Heute'
  if (d.toDateString() === yesterday.toDateString()) return 'Gestern'
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Letzte Änderungen im ganzen Wiki; Änderungen anderer seit dem letzten Ansehen sind markiert. */
export function ChangesDialog(): React.JSX.Element | null {
  const tree = useWiki((s) => s.tree)
  const seen = useWiki((s) => s.seen)
  const userName = useWiki((s) => s.userName)
  const [entries, setEntries] = useState<RecentChange[] | null>(null)
  const [onlyNew, setOnlyNew] = useState(() => {
    const s = useWiki.getState()
    return !!s.tree && unseenArticles(s.tree, s.seen).length > 0
  })
  const close = useCallback(() => useWiki.getState().setDialog(null), [])

  useEffect(() => {
    wiki
      .getRecentChanges(300)
      .then(setEntries)
      .catch((err) => useWiki.getState().toast(errorMessage(err), 'error'))
  }, [tree])

  if (!tree || !seen) return null
  const isNew = (c: RecentChange): boolean => c.author !== userName && !c.deleted && c.at > seenAt(seen, c.articleId)
  const newCount = entries?.filter(isNew).length ?? 0
  const visible = (entries ?? []).filter((c) => !onlyNew || isNew(c))
  const open = (id: number): void => {
    close()
    void useWiki.getState().reveal(id)
  }

  let lastDay = ''
  return (
    <Modal
      title="Letzte Änderungen"
      onClose={close}
      wide
      footer={
        <>
          <button className="btn btn-small footer-left" onClick={() => useWiki.getState().setDialog('user-name')}>
            <PenLine size={13} /> Du erscheinst als „{userName}“
          </button>
          <button className="btn" disabled={newCount === 0} onClick={() => useWiki.getState().markAllSeen()}>
            Alle als gesehen markieren
          </button>
          <button className="btn btn-primary" onClick={close}>
            Fertig
          </button>
        </>
      }
    >
      <div className="changes-filter" role="tablist">
        <button role="tab" aria-selected={onlyNew} className={onlyNew ? 'active' : ''} onClick={() => setOnlyNew(true)}>
          Neu von anderen ({newCount})
        </button>
        <button role="tab" aria-selected={!onlyNew} className={!onlyNew ? 'active' : ''} onClick={() => setOnlyNew(false)}>
          Alle
        </button>
      </div>
      {entries === null && <p className="muted">Lade …</p>}
      {entries && visible.length === 0 && (
        <p className="muted">
          {onlyNew ? 'Seit deinem letzten Besuch hat niemand sonst etwas geändert.' : 'Noch keine Änderungen protokolliert.'}
        </p>
      )}
      <ul className="change-list">
        {visible.map((c) => {
          const day = dayLabel(c.at)
          const heading = day !== lastDay ? day : null
          lastDay = day
          return (
            <li key={c.id} className={isNew(c) ? 'unseen' : ''}>
              {heading && <h4 className="change-day">{heading}</h4>}
              <div className="change-row">
                <button className="change-title" disabled={c.deleted} onClick={() => open(c.articleId)}>
                  {c.title}
                </button>
                {c.deleted && <small className="muted">(im Papierkorb)</small>}
                <span className="change-meta">
                  {c.author} · {formatWhen(c.at)}
                </span>
              </div>
              <div className="change-summary">{c.summary}</div>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
