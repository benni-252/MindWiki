import { ArrowDownRight, ArrowUpLeft, CornerLeftUp, FolderTree } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ArticleSummary } from '../../../shared/types'
import { useWiki } from '../store'
import { indexTree } from '../treeUtils'

function Group({ icon, title, items }: { icon: ReactNode; title: string; items: ArticleSummary[] }): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="link-group">
      <h4>
        {icon}
        {title}
      </h4>
      <div className="chips">
        {items.map((a) => (
          <button key={a.id} className="chip" onClick={() => useWiki.getState().openArticle(a.id, 'flash')}>
            {a.title}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Verknüpfungen eines Artikels: Baum (Eltern/Unterartikel) und Querverweise in beide Richtungen. */
export function Backlinks({ id }: { id: number }): React.JSX.Element | null {
  const tree = useWiki((s) => s.tree)
  if (!tree) return null
  const { byId, children } = indexTree(tree)
  const article = byId.get(id)
  if (!article) return null

  const parent = article.parentId != null ? byId.get(article.parentId) : undefined
  const pick = (ids: number[]): ArticleSummary[] =>
    ids.map((i) => byId.get(i)).filter((a): a is ArticleSummary => !!a)
  const outgoing = pick(tree.links.filter((l) => l.fromId === id).map((l) => l.toId))
  const incoming = pick(tree.links.filter((l) => l.toId === id).map((l) => l.fromId))
  const kids = children.get(id) ?? []

  if (!parent && kids.length === 0 && outgoing.length === 0 && incoming.length === 0) return null

  return (
    <section className="panel-section">
      <h3>Verknüpfungen</h3>
      <Group icon={<CornerLeftUp size={14} />} title="Übergeordnet" items={parent ? [parent] : []} />
      <Group icon={<FolderTree size={14} />} title="Unterartikel" items={kids} />
      <Group icon={<ArrowDownRight size={14} />} title="Verweist auf" items={outgoing} />
      <Group icon={<ArrowUpLeft size={14} />} title="Wird referenziert von" items={incoming} />
    </section>
  )
}
