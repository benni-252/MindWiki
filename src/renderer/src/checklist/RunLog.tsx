import { Check, ChevronDown, ChevronRight, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ChecklistRun } from '../../../shared/types'
import { errorMessage, wiki } from '../api'
import { useWiki } from '../store'

function formatRunDate(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Protokoll abgeschlossener Durchläufe einer Checkliste. */
export function RunLog({ checklistId, version, readMode }: { checklistId: number; version: number; readMode: boolean }): React.JSX.Element {
  const [runs, setRuns] = useState<ChecklistRun[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)

  const reload = async (): Promise<void> => {
    try {
      setRuns(await wiki.getRuns(checklistId))
    } catch (err) {
      useWiki.getState().toast(errorMessage(err), 'error')
    }
  }

  useEffect(() => {
    void reload()
    // version: nach einem neuen Durchlauf neu laden
  }, [checklistId, version])

  const remove = async (run: ChecklistRun): Promise<void> => {
    const ok = await useWiki.getState().confirm({
      title: 'Protokolleintrag löschen?',
      message: `Der Durchlauf vom ${formatRunDate(run.completedAt)} wird endgültig entfernt.`,
      confirmLabel: 'Löschen',
      danger: true
    })
    if (!ok) return
    await wiki.deleteRun(run.id)
    await reload()
  }

  if (!runs) return <div className="runlog muted small">Lade Protokoll …</div>
  if (runs.length === 0) return <div className="runlog muted small">Noch keine abgeschlossenen Durchläufe.</div>

  return (
    <div className="runlog">
      {runs.map((run) => {
        const done = run.snapshot.filter((s) => s.checked).length
        const complete = done === run.snapshot.length
        const expanded = open === run.id
        return (
          <div key={run.id} className="run">
            <div className="run-head">
              <button className="run-toggle" onClick={() => setOpen(expanded ? null : run.id)}>
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="run-date">{formatRunDate(run.completedAt)}</span>
                <span className={`run-count ${complete ? 'complete' : 'partial'}`}>
                  {done}/{run.snapshot.length} erledigt
                </span>
              </button>
              {!readMode && (
                <button className="icon-btn small" title="Eintrag löschen" onClick={() => void remove(run)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            {run.note && <div className="run-note">{run.note}</div>}
            {expanded && (
              <ol className="run-steps">
                {run.snapshot.map((step, i) => (
                  <li key={i} className={step.checked ? 'ok' : 'missed'}>
                    {step.checked ? <Check size={13} /> : <X size={13} />}
                    {step.text}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )
      })}
    </div>
  )
}
