import { Check, FilePlus2, PenLine, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { diffLines } from '../../../shared/diff'
import type { DraftDiff } from '../../../shared/types'
import { errorMessage, wiki } from '../api'
import { Modal } from '../dialogs/Modal'
import { useWiki } from '../store'
import { formatWhen, indexTree } from '../treeUtils'

/** Grund für eine Ablehnung abfragen. */
function RejectDialog({ id, onClose }: { id: number; onClose(): void }): React.JSX.Element {
  const [reason, setReason] = useState('')
  const reject = (): void => {
    onClose()
    void useWiki.getState().reject(id, reason)
  }
  return (
    <Modal
      title="Ablehnen"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-danger" onClick={reject}>
            Ablehnen
          </button>
        </>
      }
    >
      <p className="muted small">Optional: Warum? Der Grund erscheint im Verlauf des Artikels.</p>
      <textarea
        className="text-area"
        autoFocus
        rows={3}
        value={reason}
        aria-label="Grund"
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  )
}

/** Vergleich: freigegebener Stand und Änderungsvorschlag. */
export function DiffDialog({ id, canDecide, onClose }: { id: number; canDecide: boolean; onClose(): void }): React.JSX.Element {
  const [diff, setDiff] = useState<DraftDiff | null | undefined>(undefined)
  const [rejecting, setRejecting] = useState(false)

  useEffect(() => {
    wiki
      .getDraftDiff(id)
      .then(setDiff)
      .catch((err) => {
        useWiki.getState().toast(errorMessage(err), 'error')
        setDiff(null)
      })
  }, [id])

  const approve = (): void => {
    onClose()
    void useWiki.getState().approve(id)
  }
  const empty =
    !!diff && !diff.title && !diff.iconChanged && !diff.text && diff.fields.length === 0 && diff.checklists.length === 0

  return (
    <>
      <Modal
        title="Änderungen ansehen"
        onClose={onClose}
        wide
        footer={
          canDecide ? (
            <>
              <button className="btn" onClick={() => setRejecting(true)}>
                <X size={14} /> Ablehnen
              </button>
              <button className="btn btn-primary" onClick={approve}>
                <Check size={14} /> Freigeben
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={onClose}>
              Schließen
            </button>
          )
        }
      >
        {diff === undefined && <p className="muted">Lade …</p>}
        {diff === null && <p className="muted">Es gibt keinen offenen Änderungsvorschlag mehr.</p>}
        {diff && (
          <div className="diff">
            <p className="muted small">
              Vorschlag von {diff.author}, begonnen {formatWhen(diff.since)}. Rot: bisher, grün: neu.
            </p>
            {empty && <p>Im Entwurf wurde noch nichts geändert.</p>}
            {diff.title && (
              <div className="diff-block">
                <h4>Titel</h4>
                <div className="diff-line removed">{diff.title.before}</div>
                <div className="diff-line added">{diff.title.after}</div>
              </div>
            )}
            {diff.iconChanged && (
              <div className="diff-block">
                <h4>Symbol</h4>
                <div className="diff-line">geändert</div>
              </div>
            )}
            {diff.fields.length > 0 && (
              <div className="diff-block">
                <h4>Steckbrief</h4>
                {diff.fields.map((f) => (
                  <div key={f.label} className="diff-field">
                    <strong>{f.label}</strong>
                    {f.before != null && <span className="diff-line removed">{f.before || '—'}</span>}
                    {f.after != null ? (
                      <span className="diff-line added">{f.after || '—'}</span>
                    ) : (
                      <em className="muted">entfernt</em>
                    )}
                  </div>
                ))}
              </div>
            )}
            {diff.checklists.length > 0 && (
              <div className="diff-block">
                <h4>Abläufe</h4>
                {diff.checklists.map((c, i) => (
                  <div key={`${c.title}-${i}`} className="diff-list">
                    <strong>
                      {c.title} <small className="muted">({{ added: 'neu', removed: 'gelöscht', changed: 'geändert' }[c.change]})</small>
                    </strong>
                    {c.detail.map((line, j) => (
                      <div
                        key={j}
                        className={`diff-line ${line.startsWith('+') ? 'added' : line.startsWith('−') ? 'removed' : ''}`}
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {diff.text && (
              <div className="diff-block">
                <h4>Text</h4>
                <div className="diff-text">
                  {diffLines(diff.text.before.split('\n'), diff.text.after.split('\n')).map((line, i) => (
                    <div key={i} className={`diff-line ${line.kind}`}>
                      {line.text || ' '}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
      {rejecting && (
        <RejectDialog
          id={id}
          onClose={() => {
            setRejecting(false)
            onClose()
          }}
        />
      )}
    </>
  )
}

/** Hinweis oben im Artikel: Entwurf, Änderungsvorschlag oder „Bearbeiten“ bei Freigabe-Pflicht. */
export function ApprovalBanner({ id, readMode }: { id: number; readMode: boolean }): React.JSX.Element | null {
  const tree = useWiki((s) => s.tree)
  const userName = useWiki((s) => s.userName)
  const session = useWiki((s) => s.session)
  const canApprove = session?.role === 'editor' || session?.role === 'admin'
  const [diffOpen, setDiffOpen] = useState(false)
  const [rejecting, setRejecting] = useState(false)

  const summary = tree ? indexTree(tree).byId.get(id) : undefined
  if (!tree || !summary) return null
  const s = useWiki.getState()

  const decide = (
    <>
      <button className="btn btn-small btn-primary" onClick={() => void s.approve(id)}>
        <Check size={14} /> Freigeben
      </button>
      <button className="btn btn-small" onClick={() => setRejecting(true)}>
        <X size={14} /> Ablehnen
      </button>
    </>
  )
  const dialogs = (
    <>
      {diffOpen && (
        <DiffDialog id={id} canDecide={canApprove && summary.draftBy !== userName} onClose={() => setDiffOpen(false)} />
      )}
      {rejecting && <RejectDialog id={id} onClose={() => setRejecting(false)} />}
    </>
  )

  if (summary.draftId != null) {
    const mine = summary.draftBy === userName
    const discard = async (): Promise<void> => {
      const ok = await s.confirm({
        title: 'Entwurf verwerfen?',
        message: 'Alle Änderungen in deinem Entwurf gehen verloren. Der freigegebene Stand bleibt.',
        confirmLabel: 'Verwerfen',
        danger: true
      })
      if (ok) await s.discardDraft(id)
    }
    return (
      <section className={`approval-box ${mine ? 'mine' : 'pending'}`} aria-label="Freigabe">
        <div className="approval-head">
          <PenLine size={17} />
          <strong>{mine ? 'Dein Entwurf' : `${summary.draftBy} hat Änderungen vorgeschlagen`}</strong>
          {summary.draftAt && <span className="approval-since">seit {formatWhen(summary.draftAt)}</span>}
        </div>
        <p>
          {mine
            ? 'Du bearbeitest einen Entwurf. Die anderen sehen deine Änderungen erst, wenn jemand sie freigegeben hat.'
            : canApprove
              ? 'Unten siehst du noch den freigegebenen Stand. Sieh dir die Änderungen an und gib sie frei oder lehne sie ab.'
              : 'Unten siehst du noch den freigegebenen Stand. Ein Bearbeiter muss die Änderungen freigeben.'}
        </p>
        <div className="approval-actions">
          <button className="btn btn-small" onClick={() => setDiffOpen(true)}>
            Änderungen ansehen
          </button>
          {mine ? (
            <button className="btn btn-small" onClick={() => void discard()}>
              Entwurf verwerfen
            </button>
          ) : (
            canApprove && decide
          )}
        </div>
        {dialogs}
      </section>
    )
  }

  if (tree.approvalRequired && !summary.approved) {
    const mine = summary.createdBy === userName
    return (
      <section className="approval-box new" aria-label="Freigabe">
        <div className="approval-head">
          <FilePlus2 size={17} />
          <strong>{mine ? 'Neuer Artikel – wartet auf Freigabe' : `Neuer Artikel von ${summary.createdBy ?? '?'}`}</strong>
        </div>
        <p>
          {mine
            ? 'Ein Bearbeiter (nicht du selbst) muss ihn freigeben. Bis dahin ist er für alle als Entwurf markiert; du kannst ihn weiter bearbeiten.'
            : canApprove
              ? 'Prüfe den Inhalt und gib ihn frei oder lehne ihn ab. Abgelehnte Artikel landen im Papierkorb.'
              : 'Ein Bearbeiter muss ihn freigeben.'}
        </p>
        {!mine && canApprove && <div className="approval-actions">{decide}</div>}
        {dialogs}
      </section>
    )
  }

  if (tree.approvalRequired && !readMode) {
    return (
      <div className="approval-hint">
        <ShieldCheck size={16} />
        <span>Änderungen an diesem Artikel müssen von jemand anderem freigegeben werden.</span>
        <button className="btn btn-small btn-primary" onClick={() => void s.startDraft(id)}>
          <PenLine size={14} /> Bearbeiten
        </button>
      </div>
    )
  }
  return null
}
