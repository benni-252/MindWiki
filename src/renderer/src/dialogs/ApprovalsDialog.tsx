import { FilePlus2, PenLine } from 'lucide-react'
import { useCallback } from 'react'
import type { ArticleSummary, TreeData } from '../../../shared/types'
import { useWiki } from '../store'
import { formatWhen } from '../treeUtils'
import { Modal } from './Modal'

/** Offene Freigaben: was ich freigeben kann und was von mir noch wartet. */
export function pendingApprovals(tree: TreeData, me: string): { forMe: ArticleSummary[]; mine: ArticleSummary[] } {
  const isNew = (a: ArticleSummary): boolean => tree.approvalRequired && !a.approved
  const byOthers = (a: ArticleSummary): boolean =>
    (isNew(a) && a.createdBy !== me) || (a.draftId != null && a.draftBy !== me)
  const byMe = (a: ArticleSummary): boolean => (isNew(a) && a.createdBy === me) || (a.draftId != null && a.draftBy === me)
  return { forMe: tree.articles.filter(byOthers), mine: tree.articles.filter(byMe) }
}

function Row({ article, onOpen }: { article: ArticleSummary; onOpen(id: number): void }): React.JSX.Element {
  const isDraft = article.draftId != null
  return (
    <li>
      <button className="change-title" onClick={() => onOpen(article.id)}>
        {article.title}
      </button>
      <span className="approval-kind">
        {isDraft ? <PenLine size={13} /> : <FilePlus2 size={13} />}
        {isDraft ? 'Änderungen' : 'Neuer Artikel'}
      </span>
      <span className="change-meta">
        {isDraft ? article.draftBy : article.createdBy}
        {isDraft && article.draftAt && ` · ${formatWhen(article.draftAt)}`}
      </span>
    </li>
  )
}

export function ApprovalsDialog(): React.JSX.Element | null {
  const tree = useWiki((s) => s.tree)
  const userName = useWiki((s) => s.userName)
  const close = useCallback(() => useWiki.getState().setDialog(null), [])
  if (!tree) return null
  const { forMe, mine } = pendingApprovals(tree, userName)
  const open = (id: number): void => {
    close()
    void useWiki.getState().reveal(id)
  }

  const toggle = async (): Promise<void> => {
    const s = useWiki.getState()
    const on = !tree.approvalRequired
    const pending = forMe.length + mine.length
    const ok = await s.confirm(
      on
        ? {
            title: 'Freigabe-Pflicht einschalten?',
            message:
              'Danach muss jemand anderes jeden neuen Artikel und jede Änderung freigeben. Das gilt für alle, die diese Wiki-Datei benutzen.',
            confirmLabel: 'Einschalten'
          }
        : {
            title: 'Freigabe-Pflicht ausschalten?',
            message:
              pending > 0
                ? `Die ${pending} offenen Entwürfe werden ohne Prüfung übernommen. Danach sind alle Änderungen wieder sofort gültig.`
                : 'Danach sind alle Änderungen wieder sofort gültig.',
            confirmLabel: 'Ausschalten',
            danger: pending > 0
          }
    )
    if (ok) await s.setApprovalRequired(on)
  }

  return (
    <Modal
      title="Freigaben"
      onClose={close}
      wide
      footer={
        <button className="btn btn-primary" onClick={close}>
          Fertig
        </button>
      }
    >
      <label className="approval-switch">
        <input type="checkbox" checked={tree.approvalRequired} onChange={() => void toggle()} />
        <span>
          <strong>Neue Artikel und Änderungen müssen freigegeben werden</strong>
          <small>
            Freigeben kann nur jemand anderes als die Person, die den Artikel angelegt oder geändert hat. Gilt für alle,
            die diese Wiki-Datei benutzen. Störungen melden, Abhängigkeiten und das Abhaken von Abläufen gehen weiterhin
            sofort.
          </small>
        </span>
      </label>
      {(tree.approvalRequired || forMe.length + mine.length > 0) && (
        <>
          <h4 className="change-day">Wartet auf deine Freigabe ({forMe.length})</h4>
          {forMe.length === 0 ? (
            <p className="muted small">Nichts offen.</p>
          ) : (
            <ul className="approval-list">
              {forMe.map((a) => (
                <Row key={a.id} article={a} onOpen={open} />
              ))}
            </ul>
          )}
          <h4 className="change-day">Deine Entwürfe – warten auf andere ({mine.length})</h4>
          {mine.length === 0 ? (
            <p className="muted small">Nichts offen.</p>
          ) : (
            <ul className="approval-list">
              {mine.map((a) => (
                <Row key={a.id} article={a} onOpen={open} />
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  )
}
