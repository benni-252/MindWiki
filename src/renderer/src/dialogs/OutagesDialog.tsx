import { CircleCheck, TriangleAlert } from 'lucide-react'
import { useCallback } from 'react'
import { formatSince, ImpactGroups } from '../article/OutageBanner'
import { useWiki } from '../store'
import { impactOf } from '../treeUtils'
import { Modal } from './Modal'

/** Übersicht aller gemeldeten Störungen mit den betroffenen Artikeln. */
export function OutagesDialog(): React.JSX.Element | null {
  const tree = useWiki((s) => s.tree)
  const close = useCallback(() => useWiki.getState().setDialog(null), [])
  if (!tree) return null

  const impact = impactOf(tree)
  const outages = tree.articles
    .filter((a) => a.outageSince != null)
    .sort((a, b) => (b.outageSince ?? '').localeCompare(a.outageSince ?? ''))
  const open = (id: number): void => {
    close()
    void useWiki.getState().reveal(id)
  }

  return (
    <Modal
      title="Störungen"
      onClose={close}
      wide
      footer={
        <button className="btn btn-primary" onClick={close}>
          Fertig
        </button>
      }
    >
      {outages.length === 0 && (
        <p className="muted">
          Zurzeit ist keine Störung gemeldet. Eine Störung meldest du per Rechtsklick auf einen Artikel in der Mind Map
          („Störung melden“) oder mit dem Warndreieck oben im Artikel.
        </p>
      )}
      {outages.length > 0 && (
        <>
          <p className="muted small">
            {outages.length} {outages.length === 1 ? 'Störung' : 'Störungen'}, insgesamt {impact.affected.size}{' '}
            Artikel betroffen.
          </p>
          <ul className="outage-list">
            {outages.map((a) => (
              <li key={a.id}>
                <div className="outage-row">
                  <button className="outage-title" onClick={() => open(a.id)}>
                    <TriangleAlert size={16} />
                    {a.title}
                  </button>
                  <small>
                    seit {formatSince(a.outageSince ?? '')}
                    {a.outageNote && ` · ${a.outageNote}`}
                  </small>
                  <button className="btn btn-small" onClick={() => void useWiki.getState().resolveOutage(a.id)}>
                    <CircleCheck size={14} /> Beheben
                  </button>
                </div>
                <ImpactGroups tree={tree} impact={impact} outageId={a.id} onOpen={open} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}
