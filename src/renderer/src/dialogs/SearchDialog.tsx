import { FileText, Search } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SearchHit } from '../../../shared/types'
import { errorMessage, wiki } from '../api'
import { useWiki } from '../store'
import { pathTo } from '../treeUtils'

function highlight(text: string, query: string): ReactNode {
  const tokens = query.split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (tokens.length === 0) return text
  const parts = text.split(new RegExp(`(${tokens.join('|')})`, 'gi'))
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part))
}

export function SearchDialog(): React.JSX.Element {
  const tree = useWiki((s) => s.tree)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const close = (): void => useWiki.getState().setDialog(null)

  useEffect(() => {
    const t = setTimeout(() => {
      if (!query.trim()) {
        setHits([])
        return
      }
      wiki
        .search(query)
        .then((h) => {
          setHits(h)
          setIndex(0)
        })
        .catch((err) => useWiki.getState().toast(errorMessage(err), 'error'))
    }, 100)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const choose = (hit: SearchHit | undefined): void => {
    if (!hit) return
    close()
    void useWiki.getState().reveal(hit.id)
  }

  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal search" role="dialog" aria-label="Suche">
        <div className="search-input">
          <Search size={18} />
          <input
            autoFocus
            placeholder="Titel, Text oder Ablaufschritt suchen …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(hits.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                choose(hits[index])
              } else if (e.key === 'Escape') {
                close()
              }
            }}
          />
        </div>
        <div className="search-results" ref={listRef}>
          {query.trim() && hits.length === 0 && <p className="muted small pad">Nichts gefunden.</p>}
          {!query.trim() && <p className="muted small pad">Tippe, um im ganzen Wiki zu suchen. ↑↓ wählen, Enter öffnen.</p>}
          {hits.map((hit, i) => {
            const path = tree
              ? pathTo(tree, hit.id)
                  .slice(0, -1)
                  .map((p) => p.title)
                  .join(' › ')
              : ''
            return (
              <button
                key={hit.id}
                className={`search-hit ${i === index ? 'active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(hit)}
              >
                <FileText size={16} />
                <span>
                  <strong>{highlight(hit.title, query)}</strong>
                  {path && <small className="hit-path">{path}</small>}
                  {hit.snippet && <small className="hit-snippet">{highlight(hit.snippet, query)}</small>}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
