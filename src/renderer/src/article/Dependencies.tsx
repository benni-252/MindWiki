import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArticleSummary } from '../../../shared/types'
import { useWiki } from '../store'
import { byTitle, impactOf, pathTo } from '../treeUtils'
import { ArticleChip } from './OutageBanner'

/** Eingabefeld mit Vorschlagsliste, um einen anderen Artikel auszuwählen. */
function ArticlePicker({
  exclude,
  placeholder,
  onPick,
  onClose
}: {
  exclude: Set<number>
  placeholder: string
  onPick(id: number): void
  onClose(): void
}): React.JSX.Element {
  const tree = useWiki((s) => s.tree)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const hits = useMemo<ArticleSummary[]>(() => {
    if (!tree) return []
    const tokens = query.toLocaleLowerCase('de').split(/\s+/).filter(Boolean)
    return tree.articles
      .filter((a) => !exclude.has(a.id))
      .filter((a) => tokens.every((t) => a.title.toLocaleLowerCase('de').includes(t)))
      .sort((a, b) => a.title.localeCompare(b.title, 'de'))
      .slice(0, 8)
  }, [tree, query, exclude])

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const pick = (a: ArticleSummary | undefined): void => {
    if (a) onPick(a.id)
  }

  return (
    <div className="dep-picker">
      <input
        autoFocus
        value={query}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={onClose}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setIndex((i) => Math.min(hits.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setIndex((i) => Math.max(0, i - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            pick(hits[index])
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      />
      <div className="suggestions dep-suggestions" ref={listRef} role="listbox">
        {hits.length === 0 && <div className="suggestion-empty">Kein passender Artikel.</div>}
        {hits.map((a, i) => {
          const path = tree
            ? pathTo(tree, a.id)
                .slice(0, -1)
                .map((p) => p.title)
                .join(' › ')
            : ''
          return (
            <button
              key={a.id}
              role="option"
              aria-selected={i === index}
              className={i === index ? 'active' : ''}
              // mousedown statt click: sonst schließt das Blur des Eingabefelds die Liste vorher
              onMouseDown={(e) => {
                e.preventDefault()
                pick(a)
              }}
              onMouseEnter={() => setIndex(i)}
            >
              <span>{a.title}</span>
              {path && <small>{path}</small>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

type Direction = 'needs' | 'neededBy'

const GROUPS: Record<Direction, { title: string; hint: string; add: string; remove: string; placeholder: string }> = {
  needs: {
    title: 'Hängt ab von',
    hint: 'Fällt einer davon aus, ist dieser Artikel betroffen.',
    add: 'Abhängigkeit hinzufügen',
    remove: 'Abhängigkeit entfernen',
    placeholder: 'Wovon hängt dieser Artikel ab?'
  },
  neededBy: {
    title: 'Wird benötigt von',
    hint: 'Diese Artikel sind betroffen, wenn hier eine Störung ist.',
    add: 'Abhängigen Artikel hinzufügen',
    remove: 'Abhängigkeit entfernen',
    placeholder: 'Welcher Artikel braucht diesen?'
  }
}

/** Abhängigkeiten eines Artikels in beide Richtungen, im Bearbeiten-Modus änderbar. */
export function Dependencies({ id, readMode }: { id: number; readMode: boolean }): React.JSX.Element | null {
  const tree = useWiki((s) => s.tree)
  const [adding, setAdding] = useState<Direction | null>(null)

  useEffect(() => setAdding(null), [id, readMode])

  if (!tree) return null
  const impact = impactOf(tree)
  const lists: Record<Direction, ArticleSummary[]> = {
    needs: byTitle(
      tree,
      tree.dependencies.filter((d) => d.articleId === id).map((d) => d.dependsOnId)
    ),
    neededBy: byTitle(
      tree,
      tree.dependencies.filter((d) => d.dependsOnId === id).map((d) => d.articleId)
    )
  }
  const empty = lists.needs.length === 0 && lists.neededBy.length === 0

  if (empty && !adding) {
    if (readMode) return null
    return (
      <button className="fs-add-empty" onClick={() => setAdding('needs')}>
        <Plus size={14} /> Abhängigkeit (wovon hängt dieser Artikel ab?)
      </button>
    )
  }

  const s = useWiki.getState()
  const add = (direction: Direction, other: number): void => {
    setAdding(null)
    void (direction === 'needs' ? s.addDependency(id, other) : s.addDependency(other, id))
  }
  const remove = (direction: Direction, other: number): void => {
    void (direction === 'needs' ? s.removeDependency(id, other) : s.removeDependency(other, id))
  }

  return (
    <section className="deps" aria-label="Abhängigkeiten">
      <div className="fs-head">
        <h3>Abhängigkeiten</h3>
      </div>
      {(['needs', 'neededBy'] as const).map((direction) => {
        const group = GROUPS[direction]
        const items = lists[direction]
        if (readMode && items.length === 0) return null
        return (
          <div key={direction} className="dep-group">
            <h4 title={group.hint}>{group.title}</h4>
            <div className="chips">
              {items.map((a) => (
                <ArticleChip
                  key={a.id}
                  article={a}
                  impact={impact}
                  onRemove={readMode ? undefined : () => remove(direction, a.id)}
                  removeTitle={`${group.remove}: ${a.title}`}
                />
              ))}
              {!readMode && adding !== direction && (
                <button className="chip chip-add" title={group.add} aria-label={group.add} onClick={() => setAdding(direction)}>
                  <Plus size={13} />
                  {items.length === 0 && <span>{group.placeholder}</span>}
                </button>
              )}
            </div>
            {!readMode && adding === direction && (
              <ArticlePicker
                exclude={new Set([id, ...items.map((a) => a.id)])}
                placeholder={group.placeholder}
                onPick={(other) => add(direction, other)}
                onClose={() => setAdding(null)}
              />
            )}
          </div>
        )
      })}
    </section>
  )
}
