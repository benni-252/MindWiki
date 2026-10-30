import Mention from '@tiptap/extension-mention'
import { PluginKey } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer, type NodeViewProps } from '@tiptap/react'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import { useEffect, useImperativeHandle, useState, type Ref } from 'react'
import { useWiki } from '../store'
import { indexTree, pathTo } from '../treeUtils'

// Muss zu ARTICLE_LINK_NODE in src/main/links.ts passen.
const NODE_NAME = 'articleLink'

interface LinkItem {
  id: string
  label: string
  path: string
}

/** Darstellung eines Artikel-Links: zeigt immer den aktuellen Titel und springt beim Klick hin. */
function ArticleLinkView({ node }: NodeViewProps): React.JSX.Element {
  const id = Number(node.attrs.id)
  const title = useWiki((s) => (s.tree ? indexTree(s.tree).byId.get(id)?.title : undefined))
  const missing = title === undefined
  return (
    <NodeViewWrapper
      as="span"
      className={`article-link ${missing ? 'missing' : ''}`}
      title={missing ? 'Artikel gelöscht oder im Papierkorb' : 'Zum Artikel springen'}
      onClick={() => {
        if (!missing) useWiki.getState().openArticle(id, 'flash')
      }}
    >
      {title ?? (node.attrs.label as string | null) ?? 'Artikel'}
    </NodeViewWrapper>
  )
}

interface ListHandle {
  onKeyDown(props: SuggestionKeyDownProps): boolean
}

function SuggestionList({
  items,
  command,
  ref
}: {
  items: LinkItem[]
  command(item: LinkItem): void
  ref?: Ref<ListHandle>
}): React.JSX.Element {
  const [index, setIndex] = useState(0)
  useEffect(() => setIndex(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') {
        setIndex((i) => (items.length ? (i + 1) % items.length : 0))
        return true
      }
      if (event.key === 'ArrowUp') {
        setIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0))
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[index]
        if (item) command(item)
        return true
      }
      return false
    }
  }))

  return (
    <div className="suggestions">
      {items.length === 0 ? (
        <div className="suggestion-empty">Kein passender Artikel</div>
      ) : (
        items.map((item, i) => (
          <button
            key={item.id}
            className={i === index ? 'active' : ''}
            onMouseDown={(e) => {
              e.preventDefault()
              command(item)
            }}
            onMouseEnter={() => setIndex(i)}
          >
            <span>{item.label}</span>
            {item.path && <small>{item.path}</small>}
          </button>
        ))
      )}
    </div>
  )
}

function place(element: HTMLElement, rect: DOMRect | null | undefined): void {
  if (!rect) return
  const top = rect.bottom + 6 + 260 > window.innerHeight ? rect.top - 6 - element.offsetHeight : rect.bottom + 6
  element.style.left = `${Math.min(rect.left, window.innerWidth - 330)}px`
  element.style.top = `${Math.max(8, top)}px`
}

/** TipTap-Knoten für Artikel-Links, ausgelöst durch `[[` mit Vorschlagsliste. */
export function createArticleLink(currentArticleId: number) {
  return Mention.extend({
    name: NODE_NAME,
    addNodeView() {
      return ReactNodeViewRenderer(ArticleLinkView, { as: 'span' })
    }
  }).configure({
    HTMLAttributes: { class: 'article-link' },
    renderText: ({ node }) => `[[${(node.attrs.label as string | null) ?? node.attrs.id}]]`,
    renderHTML: ({ node }) => ['span', { 'data-type': NODE_NAME, class: 'article-link' }, String(node.attrs.label ?? '')],
    suggestion: {
      char: '[[',
      pluginKey: new PluginKey('articleLinkSuggestion'),
      allowSpaces: true,
      allowedPrefixes: null,
      items: ({ query }): LinkItem[] => {
        const tree = useWiki.getState().tree
        if (!tree) return []
        const q = query.replace(/\]+$/, '').trim().toLocaleLowerCase('de')
        return tree.articles
          .filter((a) => a.id !== currentArticleId && a.title.toLocaleLowerCase('de').includes(q))
          .sort((a, b) => {
            const as = a.title.toLocaleLowerCase('de').startsWith(q) ? 0 : 1
            const bs = b.title.toLocaleLowerCase('de').startsWith(q) ? 0 : 1
            return as - bs || a.title.localeCompare(b.title, 'de')
          })
          .slice(0, 8)
          .map((a) => ({
            id: String(a.id),
            label: a.title,
            path: pathTo(tree, a.id)
              .slice(1, -1)
              .map((p) => p.title)
              .join(' › ')
          }))
      },
      render: () => {
        let renderer: ReactRenderer<ListHandle, { items: LinkItem[]; command(item: LinkItem): void }> | null = null
        return {
          onStart: (props: SuggestionProps<LinkItem>) => {
            renderer = new ReactRenderer(SuggestionList, { props, editor: props.editor })
            renderer.element.classList.add('suggestions-host')
            document.body.appendChild(renderer.element)
            requestAnimationFrame(() => renderer && place(renderer.element as HTMLElement, props.clientRect?.()))
          },
          onUpdate: (props: SuggestionProps<LinkItem>) => {
            renderer?.updateProps(props)
            if (renderer) place(renderer.element as HTMLElement, props.clientRect?.())
          },
          onKeyDown: (props: SuggestionKeyDownProps) => {
            if (props.event.key === 'Escape') {
              renderer?.element.remove()
              return true
            }
            return renderer?.ref?.onKeyDown(props) ?? false
          },
          onExit: () => {
            renderer?.element.remove()
            renderer?.destroy()
            renderer = null
          }
        }
      }
    }
  })
}
