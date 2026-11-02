import { BookOpen, ChevronRight, Maximize2, Minimize2, PenLine, Shapes, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TEMPLATES } from '../../../shared/templates'
import type { Article, ArticleField } from '../../../shared/types'
import { errorMessage, wiki } from '../api'
import { ChecklistSection } from '../checklist/ChecklistSection'
import { IconPicker, NodeIcon } from '../icons'
import { useWiki } from '../store'
import { indexTree, pathTo, seenAt } from '../treeUtils'
import { Backlinks } from './Backlinks'
import { Dependencies } from './Dependencies'
import { Editor, type SaveStatus } from './Editor'
import { FactSheet } from './FactSheet'
import { History } from './History'
import { OutageBanner } from './OutageBanner'

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Gespeichert',
  dirty: 'Ungespeicherte Änderungen',
  saving: 'Speichert …',
  error: 'Nicht gespeichert!'
}

function TitleInput({ id, title, readOnly }: { id: number; title: string; readOnly: boolean }): React.JSX.Element {
  const [value, setValue] = useState(title)
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setValue(title)
  }, [title])

  const commit = (): void => {
    if (value.trim() && value.trim() !== title) void useWiki.getState().rename(id, value)
    else setValue(title)
  }

  return (
    <input
      className="article-title"
      value={value}
      readOnly={readOnly}
      aria-label="Titel"
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        commit()
      }}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLInputElement).blur()
          document.querySelector<HTMLElement>('.editor-content .ProseMirror')?.focus()
        }
        if (e.key === 'Escape') {
          setValue(title)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Symbol des Artikels; im Bearbeiten-Modus per Klick änderbar. */
function IconButton({ id, icon, readOnly }: { id: number; icon: string | null; readOnly: boolean }): React.JSX.Element | null {
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

  if (readOnly) return icon ? <NodeIcon id={icon} size={26} className="title-icon" /> : null
  return (
    <div className="title-icon-wrap" ref={ref}>
      <button
        className={`title-icon-btn ${icon ? '' : 'empty'}`}
        title={icon ? 'Symbol ändern' : 'Symbol wählen'}
        onClick={() => setOpen((o) => !o)}
      >
        {icon ? <NodeIcon id={icon} size={24} /> : <Shapes size={20} />}
      </button>
      {open && (
        <div className="menu menu-wide popover-menu">
          <div className="menu-caption">Symbol für die Mind Map</div>
          <IconPicker
            value={icon}
            onPick={(next) => {
              setOpen(false)
              void useWiki.getState().setIcon(id, next)
            }}
          />
        </div>
      )}
    </div>
  )
}

/** Für leere Artikel: mit einer IT-Vorlage starten. */
function TemplateChooser({ id }: { id: number }): React.JSX.Element {
  return (
    <div className="template-chooser">
      <span>Mit Vorlage starten:</span>
      {TEMPLATES.map((t) => (
        <button key={t.id} className="chip" title={t.description} onClick={() => void useWiki.getState().applyTemplate(id, t.id)}>
          <NodeIcon id={t.icon} size={14} />
          {t.name}
        </button>
      ))}
    </div>
  )
}

export function ArticlePanel({ id }: { id: number }): React.JSX.Element {
  const tree = useWiki((s) => s.tree)
  const readMode = useWiki((s) => s.readMode)
  const panelMax = useWiki((s) => s.panelMax)
  const version = useWiki((s) => s.articleVersion)
  const [article, setArticle] = useState<Article | null | undefined>(undefined)
  const [fields, setFields] = useState<ArticleField[]>([])
  const [status, setStatus] = useState<SaveStatus>('saved')
  const loadedId = useRef<number | null>(null)
  // Stand, zu dem `article` gehört: Editor und Abläufe erst neu aufbauen, wenn der neue Stand geladen ist
  const [shownVersion, setShownVersion] = useState(version)

  useEffect(() => {
    let alive = true
    // Beim Neuladen desselben Artikels (Änderung von anderen) den alten Stand stehen lassen, kein Flackern
    if (loadedId.current !== id) {
      setArticle(undefined)
      setStatus('saved')
    }
    loadedId.current = id
    Promise.all([wiki.getArticle(id), wiki.getFields(id)])
      .then(([a, f]) => {
        if (!alive) return
        setArticle(a)
        setFields(f)
        setShownVersion(version)
      })
      .catch((err) => {
        if (alive) useWiki.getState().toast(errorMessage(err), 'error')
      })
    return () => {
      alive = false
    }
  }, [id, version])

  const reloadFields = useCallback(async () => setFields(await wiki.getFields(id)), [id])

  // Was andere geändert haben, seit ich den Artikel zuletzt gesehen habe – Stand beim Öffnen merken
  const newSince = useMemo(() => {
    const seen = useWiki.getState().seen
    return seen ? seenAt(seen, id) : null
  }, [id])
  const lastOther = tree ? indexTree(tree).byId.get(id)?.lastOtherChangeAt : null
  useEffect(() => useWiki.getState().markSeen(id), [id, lastOther])

  const summary = tree ? indexTree(tree).byId.get(id) : undefined
  const path = tree ? pathTo(tree, id).slice(0, -1) : []
  const s = useWiki.getState()
  const isEmpty = !!summary && !summary.hasText && summary.checkTotal === 0 && fields.length === 0

  return (
    <aside className="panel" aria-label="Artikel">
      <div className="panel-head">
        <nav className="breadcrumb" aria-label="Pfad">
          {path.map((p) => (
            <span key={p.id}>
              <button onClick={() => s.openArticle(p.id, 'flash')}>{p.title}</button>
              <ChevronRight size={13} />
            </span>
          ))}
        </nav>
        <div className="panel-actions">
          <span className={`save-status ${status}`}>{STATUS_TEXT[status]}</span>
          {summary && (
            <button
              className={`icon-btn ${summary.outageSince ? 'outage-active' : 'danger'}`}
              title={summary.outageSince ? 'Störung beheben' : 'Störung melden'}
              aria-pressed={summary.outageSince != null}
              onClick={() => void (summary.outageSince ? s.resolveOutage(id) : s.reportOutage(id))}
            >
              <TriangleAlert size={17} />
            </button>
          )}
          <button
            className={`icon-btn ${readMode ? 'active' : ''}`}
            title={readMode ? 'Bearbeiten einschalten' : 'Lesemodus (schützt vor versehentlichen Änderungen)'}
            onClick={() => s.setReadMode(!readMode)}
          >
            {readMode ? <PenLine size={17} /> : <BookOpen size={17} />}
          </button>
          <button
            className="icon-btn"
            title={panelMax ? 'Mind Map wieder zeigen' : 'Artikel im Vollbild'}
            onClick={() => s.setPanelMax(!panelMax)}
          >
            {panelMax ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button className="icon-btn" title="Schließen (Esc in der Mind Map)" onClick={() => s.closePanel()}>
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="panel-scroll">
        <div className="panel-inner">
          {summary && (
            <div className="title-row">
              <IconButton id={id} icon={summary.icon} readOnly={readMode} />
              <TitleInput id={id} title={summary.title} readOnly={readMode} />
            </div>
          )}
          {article === undefined && <p className="muted">Lade …</p>}
          {article === null && <p className="muted">Dieser Artikel existiert nicht mehr.</p>}
          {article && (
            <>
              <OutageBanner id={article.id} readMode={readMode} />
              {isEmpty && !readMode && <TemplateChooser id={article.id} />}
              <FactSheet articleId={article.id} fields={fields} readMode={readMode} reload={reloadFields} />
              <Dependencies id={article.id} readMode={readMode} />
              <Editor
                key={`editor-${article.id}-${shownVersion}`}
                articleId={article.id}
                content={article.content}
                editable={!readMode}
                onStatus={setStatus}
              />
              <ChecklistSection key={`checklists-${article.id}-${shownVersion}`} articleId={article.id} readMode={readMode} />
              <Backlinks id={article.id} />
              <History id={article.id} newSince={newSince} />
              <p className="meta">
                Erstellt {formatDate(article.createdAt)} · zuletzt geändert{' '}
                {formatDate(summary?.lastChangeAt ?? article.updatedAt)}
                {summary?.lastChangeBy && ` von ${summary.lastChangeBy}`}
              </p>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
