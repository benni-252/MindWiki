import { ARTICLE_LINK_NODE } from './links'

// Wandelt einen Artikel in eine eigenständige HTML-Seite für den PDF-Export um.

interface Mark {
  type: string
  attrs?: Record<string, unknown>
}

export interface DocNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: Mark[]
  content?: DocNode[]
}

export interface ExportField {
  label: string
  value: string
}

export interface ExportChecklist {
  title: string
  steps: string[]
  lastRun: string | null
}

export interface ExportArticle {
  title: string
  path: string[]
  content: string | null
  fields: ExportField[]
  checklists: ExportChecklist[]
  dependsOn: string[]
  neededBy: string[]
  /** Angehängte Dokumente (nur Name und Größe – der Inhalt bleibt im Wiki) */
  attachments: { name: string; size: string }[]
  /** Hinweise oben im Dokument, z. B. Entwurf oder Störung */
  notes: { kind: 'warning' | 'danger' | 'info'; text: string }[]
  meta: string
}

export interface RenderContext {
  /** Aktueller Titel eines verlinkten Artikels (Links zeigen immer den aktuellen Namen) */
  articleTitle(id: number): string | undefined
  /** Bildadresse (wikiimg://…) → eingebettete data:-URL */
  imageSrc(src: string): string | undefined
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const SAFE_URL = /^(https?:|mailto:)/i

function renderText(node: DocNode): string {
  let html = escapeHtml(node.text ?? '')
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        html = `<strong>${html}</strong>`
        break
      case 'italic':
        html = `<em>${html}</em>`
        break
      case 'underline':
        html = `<u>${html}</u>`
        break
      case 'strike':
        html = `<s>${html}</s>`
        break
      case 'code':
        html = `<code>${html}</code>`
        break
      case 'link': {
        const href = String(mark.attrs?.href ?? '')
        html = SAFE_URL.test(href) ? `<a href="${escapeHtml(href)}">${html}</a>` : html
        break
      }
    }
  }
  return html
}

function cellAttrs(node: DocNode): string {
  const colspan = Number(node.attrs?.colspan ?? 1)
  const rowspan = Number(node.attrs?.rowspan ?? 1)
  return `${colspan > 1 ? ` colspan="${colspan}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}`
}

/** TipTap-Dokument (JSON) → HTML; unbekannte Knoten werden nur mit ihrem Inhalt übernommen. */
export function renderDoc(node: DocNode, ctx: RenderContext): string {
  const inner = (): string => (node.content ?? []).map((child) => renderDoc(child, ctx)).join('')
  switch (node.type) {
    case 'doc':
      return inner()
    case 'text':
      return renderText(node)
    case 'paragraph': {
      // leere Absätze (z. B. unter Vorlagen-Überschriften) im PDF weglassen
      const html = inner()
      return html ? `<p>${html}</p>` : ''
    }
    case 'heading': {
      // h1 ist der Artikeltitel – Überschriften im Text eine Stufe tiefer
      const level = Math.min(4, Math.max(1, Number(node.attrs?.level ?? 2)) + 1)
      return `<h${level}>${inner()}</h${level}>`
    }
    case 'bulletList':
      return `<ul>${inner()}</ul>`
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1)
      return `<ol${start !== 1 ? ` start="${start}"` : ''}>${inner()}</ol>`
    }
    case 'listItem':
      return `<li>${inner()}</li>`
    case 'blockquote':
      return `<blockquote>${inner()}</blockquote>`
    case 'codeBlock':
      return `<pre><code>${inner()}</code></pre>`
    case 'horizontalRule':
      return '<hr>'
    case 'hardBreak':
      return '<br>'
    case 'image': {
      const src = ctx.imageSrc(String(node.attrs?.src ?? ''))
      const alt = escapeHtml(String(node.attrs?.alt ?? ''))
      return src ? `<img src="${src}" alt="${alt}">` : ''
    }
    case 'table':
      return `<table class="content-table"><tbody>${inner()}</tbody></table>`
    case 'tableRow':
      return `<tr>${inner()}</tr>`
    case 'tableHeader':
      return `<th${cellAttrs(node)}>${inner()}</th>`
    case 'tableCell':
      return `<td${cellAttrs(node)}>${inner()}</td>`
    case ARTICLE_LINK_NODE: {
      const id = Number(node.attrs?.id)
      const title = ctx.articleTitle(id) ?? String(node.attrs?.label ?? 'Artikel')
      return `<span class="article-link">${escapeHtml(title)}</span>`
    }
    default:
      return inner()
  }
}

export function renderContent(content: string | null, ctx: RenderContext): string {
  if (!content) return ''
  try {
    return renderDoc(JSON.parse(content) as DocNode, ctx)
  } catch {
    return ''
  }
}

const STYLE = `
  @page { size: A4; margin: 18mm 16mm 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1d2330; margin: 0; }
  .path { font-size: 8.5pt; color: #7a8494; margin-bottom: 2mm; }
  h1 { font-size: 20pt; margin: 0 0 1mm; line-height: 1.2; }
  .meta { font-size: 8.5pt; color: #7a8494; margin-bottom: 5mm; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .04em; color: #4b5565; margin: 7mm 0 2mm;
       border-bottom: 1px solid #dde1e7; padding-bottom: 1mm; }
  .text h2 { text-transform: none; letter-spacing: 0; font-size: 14pt; color: #1d2330; border: 0; padding: 0; margin: 5mm 0 2mm; }
  .text h3 { font-size: 12pt; margin: 4mm 0 1.5mm; }
  .text h4 { font-size: 11pt; margin: 3mm 0 1mm; }
  p { margin: 0 0 2mm; }
  ul, ol { margin: 0 0 2mm; padding-left: 6mm; }
  li > p { margin: 0; }
  blockquote { margin: 0 0 2mm; padding-left: 3mm; border-left: 3px solid #dde1e7; color: #4b5565; }
  code { font-family: 'Cascadia Code', Consolas, monospace; font-size: 9.5pt; background: #f0f2f5; padding: 0 1mm; border-radius: 2px; }
  pre { background: #f0f2f5; padding: 3mm; border-radius: 4px; white-space: pre-wrap; }
  pre code { background: none; padding: 0; }
  a { color: #4f5bd5; }
  img { max-width: 100%; max-height: 180mm; margin: 2mm 0; border-radius: 3px; }
  hr { border: 0; border-top: 1px solid #dde1e7; margin: 4mm 0; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 3mm; page-break-inside: avoid; }
  .content-table th, .content-table td { border: 1px solid #c5cbd4; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
  .content-table th { background: #f0f2f5; }
  .content-table td > p, .content-table th > p { margin: 0; }
  .fields td { padding: 1.5mm 2mm; border-bottom: 1px solid #e6e9ee; vertical-align: top; }
  .fields td:first-child { width: 34%; font-weight: 600; color: #4b5565; }
  .article-link { color: #9c36b5; border-bottom: 1px dashed #9c36b5; }
  .note { padding: 2.5mm 3.5mm; border-radius: 4px; margin-bottom: 3mm; border: 1px solid; font-weight: 600; }
  .note.warning { background: #fff1e0; border-color: #e67700; color: #8a4700; }
  .note.danger { background: #fde8e8; border-color: #d63939; color: #a12020; }
  .note.info { background: #e8eafc; border-color: #4f5bd5; color: #2f3a9e; }
  .checklist { page-break-inside: avoid; margin-bottom: 4mm; }
  .checklist h3 { font-size: 11pt; margin: 0 0 1mm; }
  .checklist ol { list-style: none; padding-left: 0; }
  .checklist li { padding: 1mm 0; border-bottom: 1px solid #e6e9ee; }
  .box { display: inline-block; width: 3.2mm; height: 3.2mm; border: 1px solid #7a8494; border-radius: 1px; margin-right: 2mm; vertical-align: -0.4mm; }
  .run { font-size: 8.5pt; color: #7a8494; }
  .deps { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  .deps h3 { font-size: 10pt; color: #4b5565; margin: 0 0 1mm; }
  .muted { color: #7a8494; }
  .small-note { font-size: 8.5pt; }
`

/** Vollständige HTML-Seite für den PDF-Druck. */
export function articleToHtml(article: ExportArticle, ctx: RenderContext): string {
  const e = escapeHtml
  const parts: string[] = []
  if (article.path.length > 0) parts.push(`<div class="path">${article.path.map(e).join(' › ')}</div>`)
  parts.push(`<h1>${e(article.title)}</h1>`)
  parts.push(`<div class="meta">${e(article.meta)}</div>`)
  for (const note of article.notes) parts.push(`<div class="note ${note.kind}">${e(note.text)}</div>`)

  if (article.fields.length > 0) {
    const rows = article.fields.map((f) => `<tr><td>${e(f.label)}</td><td>${e(f.value)}</td></tr>`).join('')
    parts.push(`<h2>Steckbrief</h2><table class="fields"><tbody>${rows}</tbody></table>`)
  }

  const text = renderContent(article.content, ctx)
  if (text.trim()) parts.push(`<div class="text">${text}</div>`)

  if (article.checklists.length > 0) {
    parts.push('<h2>Abläufe</h2>')
    for (const list of article.checklists) {
      const steps = list.steps.map((s) => `<li><span class="box"></span>${e(s)}</li>`).join('')
      const run = list.lastRun ? `<div class="run">Zuletzt durchgeführt: ${e(list.lastRun)}</div>` : ''
      parts.push(`<div class="checklist"><h3>${e(list.title)}</h3><ol>${steps}</ol>${run}</div>`)
    }
  }

  if (article.attachments.length > 0) {
    const items = article.attachments.map((x) => `<li>${e(x.name)} <span class="muted">(${e(x.size)})</span></li>`).join('')
    parts.push(`<h2>Anhänge</h2><ul class="attachments">${items}</ul><p class="muted small-note">Die Dateien liegen im Wiki.</p>`)
  }

  if (article.dependsOn.length > 0 || article.neededBy.length > 0) {
    const list = (items: string[]): string =>
      items.length > 0 ? `<ul>${items.map((i) => `<li>${e(i)}</li>`).join('')}</ul>` : '<p class="muted">–</p>'
    parts.push(
      `<h2>Abhängigkeiten</h2><div class="deps"><div><h3>Hängt ab von</h3>${list(article.dependsOn)}</div>` +
        `<div><h3>Wird benötigt von</h3>${list(article.neededBy)}</div></div>`
    )
  }

  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${e(article.title)}</title><style>${STYLE}</style></head><body>${parts.join('\n')}</body></html>`
}
