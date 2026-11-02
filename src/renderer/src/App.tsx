import { ReactFlowProvider } from '@xyflow/react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { MenuAction } from '../../shared/types'
import { runAction } from './actions'
import { errorMessage, flushPending, wiki } from './api'
import { ArticlePanel } from './article/ArticlePanel'
import { ConfirmDialog } from './dialogs/ConfirmDialog'
import { ApprovalsDialog } from './dialogs/ApprovalsDialog'
import { ChangesDialog } from './dialogs/ChangesDialog'
import { AboutDialog, ShortcutsDialog } from './dialogs/InfoDialogs'
import { OutagesDialog } from './dialogs/OutagesDialog'
import { SearchDialog } from './dialogs/SearchDialog'
import { Toasts } from './dialogs/Toasts'
import { TrashDialog } from './dialogs/TrashDialog'
import { UserNameDialog } from './dialogs/UserNameDialog'
import { MindMap } from './mindmap/MindMap'
import { useWiki } from './store'
import { TopBar } from './TopBar'

const MIN_PANEL = 380

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
    const keys: Record<string, MenuAction> = { 'ctrl+k': 'search', 'ctrl+l': 'toggle-links', 'ctrl+0': 'fit', f1: 'shortcuts' }
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
          void flushPending().finally(() => void wiki.confirmClose())
        } else if (event.type === 'external-change') {
          void useWiki.getState().externalChange()
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
        {dialog === 'user-name' && <UserNameDialog />}
        {dialog === 'approvals' && <ApprovalsDialog />}
        {dialog === 'shortcuts' && <ShortcutsDialog />}
        {dialog === 'about' && <AboutDialog />}
        <ConfirmDialog />
        <Toasts />
      </div>
    </ReactFlowProvider>
  )
}
