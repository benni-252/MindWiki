import { Search, UserRound, X } from 'lucide-react'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { RecentChange } from '../../../shared/types'
import { errorMessage, wiki } from '../api'
import { useWiki } from '../store'
import { formatWhen, isDeletedUser, seenAt, unseenArticles } from '../treeUtils'
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

/** Höchstzahl der angezeigten Treffer */
const SEARCH_LIMIT = 300

/** Suchwörter wie im Hauptprozess: klein geschrieben (deutsch), an Leerzeichen getrennt. */
function searchWords(query: string): string[] {
  return query.toLocaleLowerCase('de').split(/\s+/).filter(Boolean)
}

/** Hebt die Suchwörter im Text hervor. */
function Highlight({ text, words }: { text: string; words: string[] }): React.JSX.Element {
  const lower = text.toLocaleLowerCase('de')
  // Nur wenn Kleinschreibung die Länge nicht ändert (bei deutschen Texten immer), stimmen die Stellen
  if (words.length === 0 || lower.length !== text.length) return <>{text}</>
  const ranges: [number, number][] = []
  for (const w of words) {
    for (let i = lower.indexOf(w); i !== -1; i = lower.indexOf(w, i + w.length)) ranges.push([i, i + w.length])
  }
  if (ranges.length === 0) return <>{text}</>
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  const parts: React.ReactNode[] = []
  let pos = 0
  for (const [from, to] of merged) {
    if (from > pos) parts.push(text.slice(pos, from))
    parts.push(<mark key={from}>{text.slice(from, to)}</mark>)
    pos = to
  }
  if (pos < text.length) parts.push(text.slice(pos))
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </>
  )
}

/** Letzte Änderungen im ganzen Wiki; Änderungen anderer seit dem letzten Ansehen sind markiert. */
export function ChangesDialog(): React.JSX.Element | null {
  const tree = useWiki((s) => s.tree)
  const seen = useWiki((s) => s.seen)
  const userName = useWiki((s) => s.userName)
  const [entries, setEntries] = useState<RecentChange[] | null>(null)
  const [query, setQuery] = useState('')
  /** Suchergebnis; null = keine Suche aktiv */
  const [results, setResults] = useState<RecentChange[] | null>(null)
  const searchNo = useRef(0)
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

  // Suche im ganzen Verlauf (nicht nur in den geladenen Einträgen) – kurz nach dem Tippen
  useEffect(() => {
    const q = query.trim()
    const no = ++searchNo.current
    if (!q) {
      setResults(null)
      return
    }
    const timer = setTimeout(() => {
      wiki
        .searchChanges(q, SEARCH_LIMIT)
        .then((found) => no === searchNo.current && setResults(found))
        .catch((err) => useWiki.getState().toast(errorMessage(err), 'error'))
    }, 200)
    return () => clearTimeout(timer)
  }, [query, tree])

  const clearSearch = useCallback((): boolean => {
    if (!query) return false
    setQuery('')
    return true
  }, [query])

  if (!tree || !seen) return null
  const isNew = (c: RecentChange): boolean => c.author !== userName && !c.deleted && c.at > seenAt(seen, c.articleId)
  const newCount = entries?.filter(isNew).length ?? 0
  const searching = query.trim() !== ''
  const words = searching ? searchWords(query) : []
  const source = searching ? results : entries
  const visible = (source ?? []).filter((c) => !onlyNew || isNew(c))
  const open = (id: number): void => {
    close()
    void useWiki.getState().reveal(id)
  }

  let lastDay = ''
  return (
    <Modal
      title="Letzte Änderungen"
      onClose={close}
      onEscape={clearSearch}
      wide
      footer={
        <>
          <span className="footer-left muted small inline-icon">
            <UserRound size={13} /> Angemeldet als {userName}
          </span>
          <button className="btn" disabled={newCount === 0} onClick={() => useWiki.getState().markAllSeen()}>
            Alle als gesehen markieren
          </button>
          <button className="btn btn-primary" onClick={close}>
            Fertig
          </button>
        </>
      }
    >
      <div className="changes-search">
        <Search size={15} />
        <input
          className="text-input"
          type="search"
          autoFocus
          value={query}
          aria-label="Änderungen durchsuchen"
          placeholder="Suchen: Artikel, Person, Änderung oder Datum (TT.MM.JJJJ)"
          onChange={(e) => {
            setQuery(e.target.value)
            // Gesucht wird im ganzen Verlauf, nicht nur im Neuen
            if (e.target.value.trim()) setOnlyNew(false)
          }}
        />
        {query && (
          <button className="icon-btn" title="Suche leeren (Esc)" onClick={() => setQuery('')}>
            <X size={15} />
          </button>
        )}
      </div>
      <div className="changes-filter" role="tablist">
        <button role="tab" aria-selected={onlyNew} className={onlyNew ? 'active' : ''} onClick={() => setOnlyNew(true)}>
          Neu von anderen ({newCount})
        </button>
        <button role="tab" aria-selected={!onlyNew} className={!onlyNew ? 'active' : ''} onClick={() => setOnlyNew(false)}>
          Alle
        </button>
      </div>
      {source === null && <p className="muted">{searching ? 'Suche …' : 'Lade …'}</p>}
      {source && searching && visible.length > 0 && (
        <p className="muted small changes-count">
          {visible.length === SEARCH_LIMIT
            ? `Die neuesten ${SEARCH_LIMIT} Treffer – mit weiteren Wörtern grenzt du die Suche ein.`
            : `${visible.length} Treffer`}
        </p>
      )}
      {source && visible.length === 0 && (
        <p className="muted">
          {searching
            ? `Keine Änderungen gefunden für „${query.trim()}“${onlyNew ? ' unter „Neu von anderen“' : ''}.`
            : onlyNew
              ? 'Seit deinem letzten Besuch hat niemand sonst etwas geändert.'
              : 'Noch keine Änderungen protokolliert.'}
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
                  <Highlight text={c.title} words={words} />
                </button>
                {c.deleted && <small className="muted">(im Papierkorb)</small>}
                <span className="change-meta">
                  <span className={isDeletedUser(tree, c.author) ? 'deleted-name' : ''}>
                    <Highlight text={c.author} words={words} />
                  </span>{' '}
                  ·{' '}
                  {formatWhen(c.at)}
                </span>
              </div>
              <div className="change-summary">
                <Highlight text={c.summary} words={words} />
              </div>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
