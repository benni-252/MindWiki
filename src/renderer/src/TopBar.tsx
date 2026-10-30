import { ChevronDown, Keyboard, Link2, Plus, Scan, Search, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { runAction } from './actions'
import { useWiki } from './store'
import { TemplateList } from './TemplateList'
import { indexTree } from './treeUtils'

/** Plus-Knopf: neuer Unterartikel zum ausgewählten Artikel, leer oder aus einer Vorlage. */
function AddMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', close, true)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', close, true)
    }
  }, [open])

  const pick = (templateId: string | null): void => {
    setOpen(false)
    const { tree, selectedId, createChild } = useWiki.getState()
    if (tree) void createChild(selectedId ?? tree.rootId, templateId)
  }

  return (
    <div className="add-menu" ref={ref}>
      <button
        className={`icon-btn wide ${open ? 'active' : ''}`}
        title="Neuer Unterartikel zum ausgewählten Artikel"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus size={18} />
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="menu menu-wide dropdown">
          <div className="menu-caption">Neuer Unterartikel</div>
          <TemplateList onPick={pick} />
        </div>
      )}
    </div>
  )
}

export function TopBar(): React.JSX.Element {
  const tree = useWiki((s) => s.tree)
  const dbInfo = useWiki((s) => s.dbInfo)
  const showLinks = useWiki((s) => s.showLinks)
  const rootTitle = tree ? indexTree(tree).byId.get(tree.rootId)?.title : ''

  return (
    <header className="topbar">
      <div className="brand" title={dbInfo?.path}>
        <svg className="brand-logo" viewBox="0 0 32 32" aria-hidden>
          <circle cx="16" cy="16" r="6" />
          <circle cx="5" cy="7" r="3" />
          <circle cx="27" cy="7" r="3" />
          <circle cx="27" cy="25" r="3" />
          <path d="M11 13 7 9M21 13l4-4M21 19l4 4" />
        </svg>
        <div className="brand-text">
          <strong>{rootTitle}</strong>
          <span>{dbInfo?.name}.db</span>
        </div>
      </div>

      <button className="search-trigger" onClick={() => void runAction('search')}>
        <Search size={15} />
        <span>Suchen…</span>
        <kbd>Strg+K</kbd>
      </button>

      <div className="topbar-actions">
        <AddMenu />
        <button
          className={`icon-btn ${showLinks ? 'active' : ''}`}
          title="Querverweise ein/aus (Strg+L)"
          aria-pressed={showLinks}
          onClick={() => void runAction('toggle-links')}
        >
          <Link2 size={18} />
        </button>
        <button className="icon-btn" title="Ganze Mind Map zeigen (Strg+0)" onClick={() => void runAction('fit')}>
          <Scan size={18} />
        </button>
        <button className="icon-btn" title="Papierkorb" onClick={() => void runAction('trash')}>
          <Trash2 size={18} />
        </button>
        <button className="icon-btn" title="Tastaturkürzel (F1)" onClick={() => void runAction('shortcuts')}>
          <Keyboard size={18} />
        </button>
      </div>
    </header>
  )
}
