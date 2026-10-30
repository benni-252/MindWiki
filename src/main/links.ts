/** Name des TipTap-Knotens für Artikel-Links (muss zum Editor passen). */
export const ARTICLE_LINK_NODE = 'articleLink'

interface JsonNode {
  type?: string
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
