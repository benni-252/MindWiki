/** Name des TipTap-Knotens für Artikel-Links (muss zum Editor passen). */
export const ARTICLE_LINK_NODE = 'articleLink'

interface JsonNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
}

/** Sammelt die Ziel-IDs aller Artikel-Links aus einem TipTap-Dokument (JSON-String). */
export function extractArticleLinks(content: string | null): number[] {
  if (!content) return []
  let doc: JsonNode
  try {
    doc = JSON.parse(content) as JsonNode
  } catch {
    return []
  }
  const ids = new Set<number>()
  const walk = (node: JsonNode): void => {
    if (node.type === ARTICLE_LINK_NODE) {
      const id = Number(node.attrs?.id)
      if (Number.isInteger(id) && id > 0) ids.add(id)
    }
    node.content?.forEach(walk)
  }
  walk(doc)
  return [...ids]
}

const INLINE = new Set(['text', 'hardBreak', ARTICLE_LINK_NODE, 'image'])

/** Klartext eines TipTap-Dokuments (für Suche und „hat Text“), Absätze durch Zeilenumbrüche getrennt. */
export function docText(content: string | null): string {
  if (!content) return ''
  let doc: JsonNode
  try {
    doc = JSON.parse(content) as JsonNode
  } catch {
    return ''
  }
  const blocks: string[] = []
  const inline = (node: JsonNode): string => {
    if (node.type === 'text') return node.text ?? ''
    if (node.type === 'hardBreak') return '\n'
    if (node.type === ARTICLE_LINK_NODE) return String(node.attrs?.label ?? '')
    return (node.content ?? []).map(inline).join('')
  }
  const walk = (node: JsonNode): void => {
    const children = node.content ?? []
    if (children.length > 0 && children.every((c) => INLINE.has(c.type ?? ''))) {
      blocks.push(inline(node))
      return
    }
    children.forEach(walk)
  }
  walk(doc)
  return blocks.join('\n').trim()
}
