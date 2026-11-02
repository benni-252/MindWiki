import { ArrowRight, CircleAlert, CircleCheck, TriangleAlert, X } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { impactChain, impactStatus, type Impact } from '../../../shared/impact'
import type { ArticleSummary, TreeData } from '../../../shared/types'
import { useWiki } from '../store'
import { byTitle, impactOf, indexTree } from '../treeUtils'

export function formatSince(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Artikel als Chip, eingefärbt nach Störungsstatus; optional mit Entfernen-Knopf. */
export function ArticleChip({
  article,
  impact,
  onOpen,
  onRemove,
  removeTitle,
  tooltip
}: {
  article: ArticleSummary
  impact: Impact
  onOpen?(id: number): void
  onRemove?(): void
  removeTitle?: string
  tooltip?: string
}): React.JSX.Element {
  const status = impactStatus(impact, article.id)
  const open = onOpen ?? ((id: number) => void useWiki.getState().reveal(id))
  return (
    <span className={`chip article-chip ${status ?? ''}`}>
      <button
        className="chip-main"
        title={tooltip ?? (status === 'outage' ? 'Störung' : status === 'affected' ? 'Betroffen von einer Störung' : undefined)}
        onClick={() => open(article.id)}
      >
        {status === 'outage' && <TriangleAlert size={13} />}
        {status === 'affected' && <CircleAlert size={13} />}
        {article.title}
      </button>
      {onRemove && (
        <button className="chip-x" title={removeTitle} aria-label={removeTitle} onClick={onRemove}>
          <X size={12} />
        </button>
      )}
    </span>
  )
}

/** Was von einer Störung betroffen ist, getrennt nach direkt und indirekt. */
export function ImpactGroups({
  tree,
  impact,
  outageId,
  onOpen
}: {
  tree: TreeData
  impact: Impact
  outageId: number
  onOpen?(id: number): void
}): React.JSX.Element {
  const { byId } = indexTree(tree)
  const entries = impact.byOutage.get(outageId) ?? []
  if (entries.length === 0) {
    return <p className="status-empty">Bisher ist nichts erfasst, was von diesem Artikel abhängt.</p>
  }
  const direct = byTitle(
    tree,
    entries.filter((e) => e.distance === 1).map((e) => e.id)
  )
  const indirect = byTitle(
    tree,
    entries.filter((e) => e.distance > 1).map((e) => e.id)
  )
  const chainText = (id: number): string =>
    `Betroffen über: ${impactChain(impact, id)
      .map((i) => byId.get(i)?.title ?? '?')
      .join(' → ')}`

  return (
    <div className="impact-groups">
      {direct.length > 0 && (
        <div className="impact-group">
          <h4>Direkt betroffen ({direct.length})</h4>
          <div className="chips">
            {direct.map((a) => (
              <ArticleChip key={a.id} article={a} impact={impact} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}
      {indirect.length > 0 && (
        <div className="impact-group">
          <h4>Indirekt betroffen ({indirect.length})</h4>
          <div className="chips">
            {indirect.map((a) => (
              <ArticleChip key={a.id} article={a} impact={impact} onOpen={onOpen} tooltip={chainText(a.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function NoteInput({ id, note }: { id: number; note: string | null }): React.JSX.Element {
  const [value, setValue] = useState(note ?? '')
  useEffect(() => setValue(note ?? ''), [note])
  const save = (): void => {
    if (value.trim() !== (note ?? '')) void useWiki.getState().reportOutage(id, value)
  }
  return (
    <input
      className="status-note"
      value={value}
      placeholder="Notiz zur Störung, z. B. Ursache, Ticket, Rückruf …"
      aria-label="Notiz zur Störung"
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setValue(note ?? '')
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/** Hinweis oben im Artikel: eigene Störung samt Auswirkungen oder Weg einer fremden Störung hierher. */
export function OutageBanner({ id, readMode }: { id: number; readMode: boolean }): React.JSX.Element | null {
  const tree = useWiki((s) => s.tree)
  if (!tree) return null
  const { byId } = indexTree(tree)
  const article = byId.get(id)
  if (!article) return null
  const impact = impactOf(tree)

  if (article.outageSince) {
    return (
      <section className="status-box outage" aria-label="Störung">
        <div className="status-head">
          <TriangleAlert size={18} />
          <strong>Störung</strong>
          <span className="status-since">seit {formatSince(article.outageSince)}</span>
          <button className="btn btn-small" onClick={() => void useWiki.getState().resolveOutage(id)}>
            <CircleCheck size={14} /> Störung beheben
          </button>
        </div>
        {readMode ? article.outageNote && <p className="status-text">{article.outageNote}</p> : <NoteInput id={id} note={article.outageNote} />}
        <ImpactGroups tree={tree} impact={impact} outageId={id} />
      </section>
    )
  }

  const entry = impact.affected.get(id)
  if (!entry) return null
  const chain = impactChain(impact, id)
  const cause = chain[0]
  const others = byTitle(
    tree,
    entry.causes.filter((c) => c !== cause)
  )
  return (
    <section className="status-box affected" aria-label="Betroffen von einer Störung">
      <div className="status-head">
        <CircleAlert size={18} />
        <strong>Betroffen von einer Störung</strong>
      </div>
      <div className="impact-chain">
        {chain.map((stepId, i) => {
          const step = byId.get(stepId)
          if (!step) return null
          return (
            <Fragment key={stepId}>
              {i > 0 && <ArrowRight size={14} className="chain-arrow" />}
              {stepId === id ? <strong>{step.title}</strong> : <ArticleChip article={step} impact={impact} />}
            </Fragment>
          )
        })}
      </div>
      {others.length > 0 && (
        <div className="impact-group">
          <h4>Auch abhängig von diesen Störungen</h4>
          <div className="chips">
            {others.map((a) => (
              <ArticleChip key={a.id} article={a} impact={impact} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
