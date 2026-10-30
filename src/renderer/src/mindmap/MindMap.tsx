import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Edge,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodeDrag
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useWiki } from '../store'
import { indexTree, isInSubtree } from '../treeUtils'
import { ArticleNode, focusMap, type ArticleFlowNode } from './ArticleNode'
import { ContextMenu } from './ContextMenu'
import { estimateWidth, layoutMindMap, type LayoutArticle, type LayoutNode } from './layout'
import { useAnimatedPositions } from './useAnimatedPositions'

const nodeTypes = { article: ArticleNode }

type Size = { width: number; height: number }

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/** Nächster Knoten für die Pfeiltasten-Navigation. */
function neighbour(layout: Map<number, LayoutNode>, id: number, key: string): number | null {
  const node = layout.get(id)
  if (!node) return null
  const all = [...layout.values()]

  if (key === 'ArrowUp' || key === 'ArrowDown') {
    if (node.side === 'root') return null
    const column = all.filter((n) => n.side === node.side && n.depth === node.depth).sort((a, b) => a.y - b.y)
    const next = column[column.indexOf(node) + (key === 'ArrowUp' ? -1 : 1)]
    return next?.id ?? null
  }

  const outward =
    node.side === 'root' ? (key === 'ArrowRight' ? 'right' : 'left') : (key === 'ArrowRight') === (node.side === 'right')
  if (node.side !== 'root' && !outward) return node.parentId
  const side = node.side === 'root' ? outward : node.side
  const kids = all.filter((n) => n.parentId === id && n.side === side)
  if (kids.length === 0) return null
  return kids.reduce((best, n) => (Math.abs(n.y - node.y) < Math.abs(best.y - node.y) ? n : best)).id
}

export function MindMap(): React.JSX.Element {
  const tree = useWiki((s) => s.tree)
  const selectedId = useWiki((s) => s.selectedId)
  const renamingId = useWiki((s) => s.renamingId)
  const showLinks = useWiki((s) => s.showLinks)
  const centerRequest = useWiki((s) => s.centerRequest)
  const fitNonce = useWiki((s) => s.fitNonce)
  const flow = useReactFlow<ArticleFlowNode>()
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Gemessene Knotengrößen: React Flow braucht sie zurück, das Layout nutzt die echten Breiten.
  const sizes = useRef(new Map<string, Size>())
  const [sizeVersion, bumpSizes] = useReducer((v: number) => v + 1, 0)

  const [drag, setDrag] = useState<{ id: number; x: number; y: number } | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const [flashId, setFlashId] = useState<number | null>(null)

  const layout = useMemo(() => {
    if (!tree) return new Map<number, LayoutNode>()
    const { byId } = indexTree(tree)
    const widthOf = (a: LayoutArticle, depth: number): number => {
      const measured = sizes.current.get(String(a.id))?.width
      if (measured) return measured
      const summary = byId.get(a.id)
      return (
        estimateWidth(a, depth) +
        (summary && summary.checkTotal > 0 ? 54 : 0) +
        (summary?.hasText ? 12 : 0) +
        (summary?.icon ? 22 : 0)
      )
    }
    return layoutMindMap(tree.articles, tree.rootId, widthOf)
    // sizeVersion: neu rechnen, sobald echte Breiten gemessen wurden
  }, [tree, sizeVersion])

  const positions = useAnimatedPositions(layout)

  const nodes = useMemo<ArticleFlowNode[]>(() => {
    if (!tree) return []
    const { byId } = indexTree(tree)
    const result: ArticleFlowNode[] = []
    for (const n of layout.values()) {
      const article = byId.get(n.id)
      if (!article) continue
      const key = String(n.id)
      const pos = drag?.id === n.id ? drag : (positions.get(n.id) ?? n)
      result.push({
        id: key,
        type: 'article',
        position: { x: pos.x, y: pos.y },
        origin: n.side === 'root' ? [0.5, 0.5] : n.side === 'right' ? [0, 0.5] : [1, 0.5],
        measured: sizes.current.get(key),
        draggable: n.side !== 'root' && renamingId !== n.id,
        selectable: false,
        dragging: drag?.id === n.id,
        zIndex: drag?.id === n.id ? 1000 : 0,
        data: {
          article,
          layout: n,
          selected: n.id === selectedId,
          dropTarget: n.id === dropTarget,
          renaming: n.id === renamingId,
          flash: n.id === flashId
        }
      })
    }
    return result
    // sizeVersion: gemessene Größen in die Knoten übernehmen
  }, [tree, layout, positions, drag, dropTarget, selectedId, renamingId, flashId, sizeVersion])

  const edges = useMemo<Edge[]>(() => {
    if (!tree) return []
    const result: Edge[] = []
    for (const n of layout.values()) {
      if (n.parentId == null) continue
      const right = n.side === 'right'
      result.push({
        id: `t${n.id}`,
        source: String(n.parentId),
        target: String(n.id),
        sourceHandle: right ? 'r-s' : 'l-s',
        targetHandle: right ? 'l-t' : 'r-t',
        selectable: false,
        focusable: false,
        className: 'branch-edge',
        style: { stroke: n.color, strokeWidth: Math.max(1.5, 4.5 - n.depth) }
      })
    }
    if (showLinks) {
      // Verweise in eingeklappte Äste zeigen auf den sichtbaren Vorfahren.
      const { byId } = indexTree(tree)
      const visible = (id: number): number | null => {
        let current = byId.get(id)
        while (current && !layout.has(current.id)) current = current.parentId == null ? undefined : byId.get(current.parentId)
        return current?.id ?? null
      }
      const seen = new Set<string>()
      for (const link of tree.links) {
        const from = visible(link.fromId)
        const to = visible(link.toId)
        if (from == null || to == null || from === to || seen.has(`${from}-${to}`)) continue
        seen.add(`${from}-${to}`)
        const forward = (layout.get(to)?.x ?? 0) >= (layout.get(from)?.x ?? 0)
        result.push({
          id: `x${from}-${to}`,
          source: String(from),
          target: String(to),
          sourceHandle: forward ? 'r-s' : 'l-s',
          targetHandle: forward ? 'l-t' : 'r-t',
          selectable: false,
          focusable: false,
          className: 'xref-edge',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--xref)' }
        })
      }
    }
    return result
  }, [tree, layout, showLinks])

  const onNodesChange = useCallback((changes: NodeChange<ArticleFlowNode>[]) => {
    let resized = false
    for (const change of changes) {
      // Größe 0 entsteht, wenn die Karte ausgeblendet ist (Artikel im Vollbild) – ignorieren.
      if (change.type === 'dimensions' && change.dimensions?.width && change.dimensions.height) {
        const old = sizes.current.get(change.id)
        if (!old || Math.abs(old.width - change.dimensions.width) > 1 || Math.abs(old.height - change.dimensions.height) > 1) {
          sizes.current.set(change.id, change.dimensions)
          resized = true
        }
      } else if (change.type === 'position' && change.dragging && change.position) {
        setDrag({ id: Number(change.id), ...change.position })
      }
    }
    if (resized) bumpSizes()
  }, [])

  // ---------- Drag zum Umhängen ----------

  const onNodeDrag: OnNodeDrag<ArticleFlowNode> = useCallback(
    (event, node) => {
      if (!tree) return
      const draggedId = Number(node.id)
      const point = 'touches' in event ? event.touches[0] : event
      if (!point) return
      const hit = document
        .elementsFromPoint(point.clientX, point.clientY)
        .map((el) => el.closest<HTMLElement>('.react-flow__node'))
        .find((el) => el && el.dataset.id !== node.id)
      const targetId = hit?.dataset.id ? Number(hit.dataset.id) : null
      const valid = targetId != null && !isInSubtree(tree, targetId, draggedId)
      setDropTarget(valid ? targetId : null)
    },
    [tree]
  )

  const onNodeDragStop: OnNodeDrag<ArticleFlowNode> = useCallback(
    (_event, node) => {
      const target = dropTarget
      setDrag(null)
      setDropTarget(null)
      if (target != null) void useWiki.getState().move(Number(node.id), target)
    },
    [dropTarget]
  )

  // ---------- Maus ----------

  const onNodeClick: NodeMouseHandler<ArticleFlowNode> = useCallback((_e, node) => {
    useWiki.getState().openArticle(Number(node.id), true)
    focusMap()
  }, [])

  const onNodeDoubleClick: NodeMouseHandler<ArticleFlowNode> = useCallback((_e, node) => {
    useWiki.getState().setRenaming(Number(node.id))
  }, [])

  const onNodeContextMenu: NodeMouseHandler<ArticleFlowNode> = useCallback((event, node) => {
    event.preventDefault()
    useWiki.getState().select(Number(node.id))
    setMenu({ id: Number(node.id), x: event.clientX, y: event.clientY })
  }, [])

  const closeMenu = useCallback(() => setMenu(null), [])

  // ---------- Tastatur ----------

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!tree || isTyping(e.target)) return
    if ((e.ctrlKey || e.metaKey) && e.key !== 'Enter') return
    const s = useWiki.getState()
    const id = s.selectedId ?? tree.rootId
    const handled = (): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    switch (e.key) {
      case 'Tab':
        handled()
        void s.createChild(id)
        break
      case 'Enter':
        handled()
        if (e.ctrlKey) s.openArticle(id, true)
        else void s.createSibling(id)
        break
      case 'F2':
        handled()
        s.setRenaming(id)
        break
      case 'Delete':
        handled()
        void s.remove(id)
        break
      case ' ':
        handled()
        void s.toggleCollapsed(id)
        break
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        handled()
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          void s.reorder(id, e.key === 'ArrowUp' ? -1 : 1)
          break
        }
        const next = neighbour(layout, id, e.key)
        if (next != null) s.select(next, true)
        else if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && layout.get(id)?.hiddenCount) void s.toggleCollapsed(id)
        break
      }
      case 'Escape':
        if (s.panelOpen) {
          handled()
          s.closePanel()
        }
        break
    }
  }

  // ---------- Kamera ----------

  useEffect(() => {
    if (!centerRequest) return
    const n = layout.get(centerRequest.id)
    if (!n) return
    // kurz warten, bis React Flow eine geänderte Kartenbreite (Panel geöffnet) bemerkt hat
    const t = setTimeout(() => {
      const size = sizes.current.get(String(n.id)) ?? { width: 160, height: 36 }
      const cx = n.side === 'root' ? n.x : n.x + (n.side === 'right' ? 1 : -1) * (size.width / 2)
      const rect = wrapperRef.current?.getBoundingClientRect()
      const screen = flow.flowToScreenPosition({ x: cx, y: n.y })
      const margin = 80
      const offscreen =
        !rect ||
        screen.x < rect.left + margin ||
        screen.x > rect.right - margin ||
        screen.y < rect.top + margin ||
        screen.y > rect.bottom - margin
      if (offscreen) void flow.setCenter(cx, n.y, { zoom: Math.max(flow.getZoom(), 0.8), duration: 350 })
    }, 50)
    return () => clearTimeout(t)
    // nur auf neue Anfragen reagieren, nicht auf jede Layoutänderung
  }, [centerRequest])

  useEffect(() => {
    if (!centerRequest?.flash) return
    setFlashId(centerRequest.id)
    const t = setTimeout(() => setFlashId(null), 1400)
    return () => clearTimeout(t)
  }, [centerRequest])

  useEffect(() => {
    if (fitNonce === 0) return
    const t = setTimeout(() => void flow.fitView({ padding: 0.2, maxZoom: 1.1, duration: 300 }), 60)
    return () => clearTimeout(t)
  }, [fitNonce, flow])

  return (
    <div
      ref={wrapperRef}
      className="mm-wrapper"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={(e: MouseEvent) => {
        if (!isTyping(e.target)) focusMap()
      }}
    >
      <ReactFlow<ArticleFlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        disableKeyboardA11y
        zoomOnDoubleClick={false}
        nodeDragThreshold={6}
        minZoom={0.1}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
        colorMode="system"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => (n as ArticleFlowNode).data.layout.color || 'var(--accent)'}
          nodeStrokeWidth={0}
        />
        <Controls showInteractive={false} />
      </ReactFlow>
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </div>
  )
}
