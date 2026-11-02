import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { CircleAlert, ListChecks, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ImpactStatus } from '../../../shared/impact'
import type { ArticleSummary } from '../../../shared/types'
import { NodeIcon } from '../icons'
import { useWiki } from '../store'
import type { LayoutNode } from './layout'

export interface ArticleNodeData extends Record<string, unknown> {
  article: ArticleSummary
  layout: LayoutNode
  selected: boolean
  dropTarget: boolean
  renaming: boolean
  flash: boolean
  /** Eigene Störung oder betroffen durch eine Störung */
  status: ImpactStatus
  /** Stärkster Status im eingeklappten Ast darunter */
  hiddenStatus: ImpactStatus
  /** Tooltip mit Titel und ggf. Störungsangaben */
  tooltip: string
}

export type ArticleFlowNode = Node<ArticleNodeData, 'article'>

export function focusMap(): void {
  document.querySelector<HTMLElement>('.mm-wrapper')?.focus()
}

function RenameInput({ article }: { article: ArticleSummary }): React.JSX.Element {
  const [value, setValue] = useState(article.title)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  // Neue Knoten sind unsichtbar, bis React Flow sie vermessen hat – so lange erneut versuchen.
  useEffect(() => {
    let frame = 0
    let tries = 0
    const attempt = (): void => {
      const el = ref.current
      if (!el) return
      el.focus()
      if (document.activeElement === el) el.select()
      else if (++tries < 30) frame = requestAnimationFrame(attempt)
    }
    attempt()
    return () => cancelAnimationFrame(frame)
  }, [])

  const finish = (save: boolean): void => {
    if (done.current) return
    done.current = true
    const { rename, setRenaming } = useWiki.getState()
    setRenaming(null)
    if (save && value.trim() && value.trim() !== article.title) void rename(article.id, value)
    focusMap()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    e.stopPropagation()
    if (e.key === 'Enter') finish(true)
    else if (e.key === 'Escape') finish(false)
  }

  return (
    <input
      ref={ref}
      className="mm-rename nodrag nopan"
      value={value}
      size={Math.max(8, value.length + 1)}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
    />
  )
}

export function ArticleNode({ data }: NodeProps<ArticleFlowNode>): React.JSX.Element {
  const { article, layout, selected, dropTarget, renaming, flash, status, hiddenStatus, tooltip } = data
  const depthClass = `depth-${Math.min(layout.depth, 3)}`
  const classes = ['mm-node', depthClass, `side-${layout.side}`]
  if (status) classes.push(status)
  if (selected) classes.push('selected')
  if (dropTarget) classes.push('drop-target')
  if (flash) classes.push('flash')
  if (article.checkTotal > 0 && article.checkDone === article.checkTotal) classes.push('all-done')

  return (
    <div
      className={classes.join(' ')}
      style={{ '--branch': layout.color || undefined } as React.CSSProperties}
      title={tooltip}
    >
      <Handle type="target" position={Position.Left} id="l-t" isConnectable={false} />
      <Handle type="source" position={Position.Left} id="l-s" isConnectable={false} />
      <Handle type="target" position={Position.Right} id="r-t" isConnectable={false} />
      <Handle type="source" position={Position.Right} id="r-s" isConnectable={false} />

      {article.icon && (
        <NodeIcon id={article.icon} size={layout.depth === 0 ? 20 : layout.depth === 1 ? 16 : 14} className="mm-icon" />
      )}
      {renaming ? <RenameInput article={article} /> : <span className="mm-title">{article.title}</span>}
      {status === 'outage' && <TriangleAlert size={14} className="mm-status" aria-label="Störung" />}
      {status === 'affected' && <CircleAlert size={14} className="mm-status" aria-label="Betroffen" />}
      {article.hasText && !renaming && <span className="mm-dot" title="Artikel enthält Text" />}
      {article.checkTotal > 0 && (
        <span className="mm-badge" title="Erledigte Ablaufschritte">
          <ListChecks size={12} />
          {article.checkDone}/{article.checkTotal}
        </span>
      )}
      {layout.childCount > 0 && layout.side !== 'root' && (
        <button
          className={`mm-toggle nodrag nopan ${layout.hiddenCount > 0 ? 'collapsed' : ''} ${hiddenStatus ? `hides-${hiddenStatus}` : ''}`}
          title={
            layout.hiddenCount > 0
              ? `Ast aufklappen${hiddenStatus === 'outage' ? ' (enthält eine Störung)' : hiddenStatus === 'affected' ? ' (enthält betroffene Artikel)' : ''}`
              : 'Ast einklappen'
          }
          onClick={(e) => {
            e.stopPropagation()
            void useWiki.getState().toggleCollapsed(article.id)
          }}
        >
          {layout.hiddenCount > 0 ? `+${layout.hiddenCount}` : '−'}
        </button>
      )}
    </div>
  )
}
