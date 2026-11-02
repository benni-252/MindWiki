import {
  ArrowDownCircle,
  ChevronDown,
  History,
  Keyboard,
  Link2,
  Plus,
  Scan,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { runAction } from './actions'
import { pendingApprovals } from './dialogs/ApprovalsDialog'
import { useWiki } from './store'
import { TemplateList } from './TemplateList'
import { impactOf, indexTree, unseenArticles } from './treeUtils'

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

/** Rote Anzeige, solange Störungen gemeldet sind; öffnet die Übersicht. */
function OutageIndicator(): React.JSX.Element | null {
  const tree = useWiki((s) => s.tree)
  if (!tree) return null
  const impact = impactOf(tree)
  const outages = impact.outages.size
  if (outages === 0) return null
  const affected = impact.affected.size
  return (
    <button className="outage-pill" title="Störungen und betroffene Artikel anzeigen" onClick={() => void runAction('outages')}>
      <TriangleAlert size={15} />
      <strong>
        {outages} {outages === 1 ? 'Störung' : 'Störungen'}
      </strong>
      {affected > 0 && <span>· {affected} betroffen</span>}
    </button>
  )
}

/** Letzte Änderungen; Zähler für Artikel, die andere seit meinem letzten Besuch geändert haben. */
function ChangesButton(): React.JSX.Element {
  const tree = useWiki((s) => s.tree)
  const seen = useWiki((s) => s.seen)
  const count = tree ? unseenArticles(tree, seen).length : 0
  return (
    <button
      className={`icon-btn badge-host ${count > 0 ? 'has-news' : ''}`}
      title={count > 0 ? `${count} ${count === 1 ? 'Artikel wurde' : 'Artikel wurden'} von anderen geändert` : 'Letzte Änderungen (Strg+Umschalt+H)'}
      onClick={() => void runAction('changes')}
    >
      <History size={18} />
      {count > 0 && <span className="badge">{count > 99 ? '99+' : count}</span>}
    </button>
  )
}

/** Freigaben: nur bei Freigabe-Pflicht oder offenen Entwürfen; Zähler für das, was ich freigeben kann. */
function ApprovalsButton(): React.JSX.Element | null {
  const tree = useWiki((s) => s.tree)
  const userName = useWiki((s) => s.userName)
  if (!tree) return null
  const { forMe, mine } = pendingApprovals(tree, userName)
  const total = forMe.length + mine.length
  if (!tree.approvalRequired && total === 0) return null
  if (total === 0) {
    return (
      <button className="icon-btn" title="Freigaben – nichts offen" onClick={() => void runAction('approvals')}>
        <ShieldCheck size={18} />
      </button>
    )
  }
  const details = [
    forMe.length > 0 && `${forMe.length} ${forMe.length === 1 ? 'wartet' : 'warten'} auf deine Freigabe`,
    mine.length > 0 && `${mine.length} ${mine.length === 1 ? 'eigener Entwurf wartet' : 'eigene Entwürfe warten'} auf andere`
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <button
      className={`approval-pill ${forMe.length > 0 ? 'for-me' : 'mine'}`}
      title={details}
      onClick={() => void runAction('approvals')}
    >
      <ShieldAlert size={15} />
      <strong>{total}</strong> {total === 1 ? 'Freigabe offen' : 'Freigaben offen'}
    </button>
  )
}

/** Hinweis auf eine neue Version, solange sie verfügbar, im Download oder installationsbereit ist. */
function UpdateIndicator(): React.JSX.Element | null {
  const update = useWiki((s) => s.update)
  if (update.status !== 'available' && update.status !== 'downloading' && update.status !== 'ready') return null
  const label =
    update.status === 'ready'
      ? 'Neu starten zum Aktualisieren'
      : update.status === 'downloading'
        ? `Update wird geladen … ${update.percent ?? 0} %`
        : `Update ${update.version ?? ''} verfügbar`
  return (
    <button className="update-pill" title="Neue MindWiki-Version" onClick={() => useWiki.getState().setDialog('update')}>
      <ArrowDownCircle size={15} />
      {label}
    </button>
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

      <OutageIndicator />
      <UpdateIndicator />

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
        <ApprovalsButton />
        <ChangesButton />
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
