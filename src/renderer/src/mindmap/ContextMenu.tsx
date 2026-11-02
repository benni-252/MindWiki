import { ChevronLeft, ChevronRight, CircleCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconPicker } from '../icons'
import { useWiki } from '../store'
import { TemplateList } from '../TemplateList'
import { indexTree } from '../treeUtils'
import { BRANCH_COLORS } from './layout'

interface Props {
  id: number
  x: number
  y: number
  onClose(): void
}

type View = 'main' | 'templates' | 'icons'

export function ContextMenu({ id, x, y, onClose }: Props): React.JSX.Element | null {
  const tree = useWiki((s) => s.tree)
  const ref = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>('main')
  const [pos, setPos] = useState({ left: x, top: y })

  useEffect(() => {
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', close, true)
    window.addEventListener('wheel', onClose, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', close, true)
      window.removeEventListener('wheel', onClose, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  // Menü im Fenster halten (Höhe hängt von der Ansicht ab)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8))
    })
  }, [view, x, y])

  if (!tree) return null
  const { byId, children } = indexTree(tree)
  const article = byId.get(id)
  if (!article) return null
  const isRoot = article.parentId == null
  const hasChildren = (children.get(id)?.length ?? 0) > 0
  const s = useWiki.getState()

  const action = (fn: () => unknown) => () => {
    onClose()
    void fn()
  }

  const back = (title: string): React.JSX.Element => (
    <button className="menu-back" onClick={() => setView('main')}>
      <ChevronLeft size={15} /> {title}
    </button>
  )

  return (
    <div ref={ref} className={`menu ${view !== 'main' ? 'menu-wide' : ''}`} style={pos} role="menu">
      {view === 'templates' && (
        <>
          {back('Unterartikel aus Vorlage')}
          <TemplateList blank={false} onPick={(t) => action(() => s.createChild(id, t))()} />
        </>
      )}

      {view === 'icons' && (
        <>
          {back('Symbol wählen')}
          <IconPicker value={article.icon} onPick={(icon) => action(() => s.setIcon(id, icon))()} />
        </>
      )}

      {view === 'main' && (
        <>
          <button onClick={action(() => s.openArticle(id, true))}>
            Artikel öffnen <kbd>Strg+Enter</kbd>
          </button>
          <button onClick={action(() => s.exportPdf(id))}>
            Als PDF exportieren <kbd>Strg+P</kbd>
          </button>
          {article.outageSince ? (
            <button className="menu-ok" onClick={action(() => s.resolveOutage(id))}>
              Störung beheben <CircleCheck size={15} />
            </button>
          ) : (
            <button className="danger" onClick={action(() => s.reportOutage(id))}>
              Störung melden <TriangleAlert size={15} />
            </button>
          )}
          <hr />
          <button onClick={action(() => s.createChild(id))}>
            Unterartikel hinzufügen <kbd>Tab</kbd>
          </button>
          <button onClick={() => setView('templates')}>
            Unterartikel aus Vorlage <ChevronRight size={15} />
          </button>
          {!isRoot && (
            <button onClick={action(() => s.createSibling(id))}>
              Artikel daneben hinzufügen <kbd>Enter</kbd>
            </button>
          )}
          <hr />
          <button onClick={action(() => s.setRenaming(id))}>
            Umbenennen <kbd>F2</kbd>
          </button>
          <button onClick={() => setView('icons')}>
            Symbol wählen <ChevronRight size={15} />
          </button>
          {hasChildren && !isRoot && (
            <button onClick={action(() => s.toggleCollapsed(id))}>
              {article.collapsed ? 'Ast aufklappen' : 'Ast einklappen'} <kbd>Leertaste</kbd>
            </button>
          )}
          {!isRoot && (
            <>
              <button onClick={action(() => s.reorder(id, -1))}>
                Nach oben <kbd>Alt+↑</kbd>
              </button>
              <button onClick={action(() => s.reorder(id, 1))}>
                Nach unten <kbd>Alt+↓</kbd>
              </button>
              <hr />
              <div className="menu-colors" aria-label="Astfarbe">
                {BRANCH_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`swatch ${article.color === c ? 'active' : ''}`}
                    style={{ background: c }}
                    title="Astfarbe"
                    onClick={action(() => s.setColor(id, c))}
                  />
                ))}
                <button className="swatch auto" title="Automatische Farbe" onClick={action(() => s.setColor(id, null))}>
                  A
                </button>
              </div>
              <hr />
              <button className="danger" onClick={action(() => s.remove(id))}>
                In den Papierkorb <kbd>Entf</kbd>
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}
