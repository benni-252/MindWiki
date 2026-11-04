import { ReactFlowProvider } from '@xyflow/react'
import { CloudOff, FlaskConical, KeyRound } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { MenuAction } from '../../shared/types'
import { runAction } from './actions'
import { errorMessage, wiki } from './api'
import { ArticlePanel } from './article/ArticlePanel'
import { ConfirmDialog } from './dialogs/ConfirmDialog'
import { ApprovalsDialog } from './dialogs/ApprovalsDialog'
import { ChangesDialog } from './dialogs/ChangesDialog'
import { AboutDialog, ShortcutsDialog } from './dialogs/InfoDialogs'
import { OutagesDialog } from './dialogs/OutagesDialog'
import { SearchDialog } from './dialogs/SearchDialog'
import { Toasts } from './dialogs/Toasts'
import { TrashDialog } from './dialogs/TrashDialog'
import { ChangePasswordDialog } from './dialogs/ChangePasswordDialog'
import { ProxyLoginDialog } from './dialogs/ProxyLoginDialog'
import { UpdateDialog } from './dialogs/UpdateDialog'
import { UsersDialog } from './dialogs/UsersDialog'
import { LoginScreen } from './LoginScreen'
import { MindMap } from './mindmap/MindMap'
import { useWiki } from './store'
import { TopBar } from './TopBar'

const MIN_PANEL = 380

/** Erinnerung, solange der Admin noch das Start-Passwort „admin“ hat. */
function AdminPasswordBar(): React.JSX.Element | null {
  const session = useWiki((s) => s.session)
  const info = useWiki((s) => s.loginInfo)
  if (session?.role !== 'admin' || !info?.defaultAdminPassword) return null
  return (
    <div className="notice-bar warning" role="note">
      <KeyRound size={16} />
      <span>
        Das Admin-Passwort ist noch <strong>„admin“</strong> – bitte ändern.
      </span>
      <button className="btn btn-small btn-primary" onClick={() => useWiki.getState().setDialog('change-password')}>
        Passwort ändern…
      </button>
    </div>
  )
}

/** Hinweis, solange das mitgelieferte Beispiel-Wiki offen ist. */
function SampleBar(): React.JSX.Element | null {
  const dbInfo = useWiki((s) => s.dbInfo)
  if (!dbInfo?.isSample) return null
  return (
    <div className="notice-bar" role="note">
      <FlaskConical size={16} />
      <span>
        <strong>Beispiel-Wiki</strong> mit erfundenen Daten – zum Ausprobieren.
      </span>
      <button className="btn btn-small btn-primary" onClick={() => void runAction('new-db')}>
        Eigenes Wiki anlegen…
      </button>
      <button className="btn btn-small" onClick={() => void runAction('open-db')}>
        Wiki öffnen…
      </button>
    </div>
  )
}

/** Texte, die nicht gespeichert werden konnten und auf diesem Rechner aufgehoben sind. */
function UnsavedBar(): React.JSX.Element | null {
  const unsaved = useWiki((s) => s.unsaved)
  const panelOpen = useWiki((s) => s.panelOpen)
  const selectedId = useWiki((s) => s.selectedId)
  // Der offene Artikel zeigt seinen Hinweis selbst
  const shown = unsaved.filter((u) => !(panelOpen && u.articleId === selectedId))
  if (shown.length === 0) return null
  return (
    <div className="notice-bar danger" role="note">
      <CloudOff size={16} />
      <span>
        <strong>Nicht gespeicherter Text</strong> ist auf diesem Rechner aufgehoben:
      </span>
      {shown.slice(0, 3).map((u) => (
        <button
          key={u.contentId}
          className="btn btn-small"
          onClick={() => useWiki.getState().openArticle(u.articleId, 'flash')}
        >
          {u.title || 'Artikel'} öffnen
        </button>
      ))}
      {shown.length > 3 && <span>und {shown.length - 3} weitere</span>}
    </div>
  )
}

function readPanelWidth(): number {
  try {
    const v = Number(localStorage.getItem('mindwiki.panelWidth'))
    return v >= MIN_PANEL ? v : 560
  } catch {
    return 560
  }
}

export function App(): React.JSX.Element {
  const tree = useWiki((s) => s.tree)
  const selectedId = useWiki((s) => s.selectedId)
  const panelOpen = useWiki((s) => s.panelOpen)
  const panelMax = useWiki((s) => s.panelMax)
  const dialog = useWiki((s) => s.dialog)
  const session = useWiki((s) => s.session)
  const loginInfo = useWiki((s) => s.loginInfo)
  const [fatal, setFatal] = useState<string | null>(null)
  const [panelWidth, setPanelWidth] = useState(readPanelWidth)
  const dragging = useRef(false)

  useEffect(() => {
    useWiki
      .getState()
      .loadAll()
      .catch((err) => setFatal(errorMessage(err)))
  }, [])

  // Die Kürzel hängen am Anwendungsmenü; dies greift nur, falls das Menü sie nicht abfängt.
  useEffect(() => {
    const keys: Record<string, MenuAction> = {
      'ctrl+k': 'search',
      'ctrl+l': 'toggle-links',
      'ctrl+0': 'fit',
      'ctrl+p': 'export-pdf',
      'ctrl+s': 'save',
      f1: 'shortcuts'
    }
    const onKey = (e: KeyboardEvent): void => {
      const combo = `${e.ctrlKey || e.metaKey ? 'ctrl+' : ''}${e.key.toLowerCase()}`
      const action = keys[combo]
      if (!action || e.altKey || e.shiftKey) return
      e.preventDefault()
      void runAction(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(
    () =>
      wiki.onEvent((event) => {
        if (event.type === 'request-close') {
          void (async () => {
            // Nicht nach 3 Sekunden zwangsweise schließen, solange hier noch gespeichert oder nachgefragt wird
            await wiki.holdClose()
            const ok = await useWiki.getState().confirmLeave('app').catch(() => true)
            if (ok) await wiki.confirmClose()
          })()
        } else if (event.type === 'external-change') {
          void useWiki.getState().externalChange()
        } else if (event.type === 'update') {
          useWiki.getState().setUpdate(event.state)
        } else if (event.type === 'proxy-login') {
          useWiki.getState().setProxyPrompt(event.prompt)
        } else {
          void runAction(event.action)
        }
      }),
    []
  )

  const onResizeStart = (e: PointerEvent<HTMLDivElement>): void => {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onResizeMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    const max = Math.max(MIN_PANEL, window.innerWidth - 320)
    setPanelWidth(Math.min(max, Math.max(MIN_PANEL, window.innerWidth - e.clientX)))
  }
  const onResizeEnd = (): void => {
    if (!dragging.current) return
    dragging.current = false
    try {
      localStorage.setItem('mindwiki.panelWidth', String(panelWidth))
    } catch {
      // nur Komfort
    }
  }

  if (fatal) {
    return (
      <div className="fatal">
        <h1>MindWiki konnte nicht starten</h1>
        <p>{fatal}</p>
      </div>
    )
  }
  if (!loginInfo) return <div className="loading">Lade Wiki …</div>
  if (!session) {
    return (
      <>
        <LoginScreen key={`${loginInfo.isSample}-${loginInfo.lastUser}`} />
        <ProxyLoginDialog />
        <Toasts />
      </>
    )
  }
  if (!tree) return <div className="loading">Lade Wiki …</div>

  const showPanel = panelOpen && selectedId != null

  return (
    <ReactFlowProvider>
      <div className="app">
        <TopBar />
        <main
          className={`workspace ${showPanel ? 'with-panel' : ''} ${showPanel && panelMax ? 'panel-max' : ''}`}
          style={{ '--panel-width': `${panelWidth}px` } as React.CSSProperties}
        >
          <div className="notices">
            <UnsavedBar />
            <AdminPasswordBar />
            <SampleBar />
          </div>
          <MindMap />
          {showPanel && (
            <>
              {!panelMax && (
                <div
                  className="resizer"
                  role="separator"
                  aria-orientation="vertical"
                  title="Breite ändern"
                  onPointerDown={onResizeStart}
                  onPointerMove={onResizeMove}
                  onPointerUp={onResizeEnd}
                  onPointerCancel={onResizeEnd}
                />
              )}
              <ArticlePanel id={selectedId} />
            </>
          )}
        </main>
        {dialog === 'search' && <SearchDialog />}
        {dialog === 'trash' && <TrashDialog />}
        {dialog === 'outages' && <OutagesDialog />}
        {dialog === 'changes' && <ChangesDialog />}
        {dialog === 'users' && <UsersDialog />}
        {dialog === 'change-password' && <ChangePasswordDialog />}
        {dialog === 'approvals' && <ApprovalsDialog />}
        {dialog === 'update' && <UpdateDialog />}
        {dialog === 'shortcuts' && <ShortcutsDialog />}
        {dialog === 'about' && <AboutDialog />}
        <ConfirmDialog />
        <ProxyLoginDialog />
        <Toasts />
      </div>
    </ReactFlowProvider>
  )
}
