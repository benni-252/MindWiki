import Image from '@tiptap/extension-image'
import { TableCell, TableHeader, TableRow, Table } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { EditorContent, Extension, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { diffLines } from '../../../shared/diff'
import { errorMessage, setFailed, setPending, wiki } from '../api'
import { useWiki } from '../store'
import { createArticleLink } from './articleLink'
import { imageFiles, insertImages } from './images'
import { Toolbar } from './Toolbar'

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

interface Props {
  /** Wohin gespeichert wird (Artikel oder eigener Entwurf) */
  articleId: number
  /** Artikel in der Mind Map und sein Titel – für die Sicherheitskopie, falls Speichern scheitert */
  panelId: number
  title: string
  content: string | null
  editable: boolean
  onStatus(status: SaveStatus): void
  /**
   * Freigabe: 'all' – der ganze Text ist noch nicht freigegeben (neuer Artikel);
   * 'changes' – Entwurf, Absätze mit Unterschieden zu `baseline` werden markiert.
   */
  unapproved?: 'all' | 'changes' | null
  /** Freigegebener Text (TipTap-JSON) zum Vergleich bei 'changes' */
  baseline?: string | null
}

const SAVE_DELAY = 600
/** Nach einem Fehler erneut versuchen – erst nach 5 s, dann seltener (höchstens alle 30 s) */
const RETRY_DELAYS = [5000, 10_000, 20_000, 30_000]
/** Während die Wiki-Datei nicht erreichbar ist: Tippen nach so kurzer Pause in die Sicherheitskopie */
const KEEP_DELAY = 1000

/** Markiert Absätze (oberste Ebene), die es im freigegebenen Text so nicht gibt. */
function unapprovedBlocks(baseline: string | null): Extension {
  const key = new PluginKey<DecorationSet>('unapprovedBlocks')
  return Extension.create({
    name: 'unapprovedBlocks',
    addProseMirrorPlugins() {
      const blockKey = (node: PMNode): string => JSON.stringify(node.toJSON())
      let base: string[] = []
      try {
        if (baseline) base = PMNode.fromJSON(this.editor.schema, JSON.parse(baseline)).content.content.map(blockKey)
      } catch {
        base = []
      }
      const compute = (doc: PMNode): DecorationSet => {
        const blocks: { node: PMNode; pos: number }[] = []
        doc.forEach((node, pos) => blocks.push({ node, pos }))
        const decorations: Decoration[] = []
        let i = 0
        for (const line of diffLines(base, blocks.map((b) => blockKey(b.node)))) {
          if (line.kind === 'removed') continue
          const block = blocks[i++]
          // leere Absätze nicht markieren, das wäre nur Rauschen
          if (line.kind === 'added' && block.node.content.size > 0) {
            decorations.push(Decoration.node(block.pos, block.pos + block.node.nodeSize, { class: 'unapproved-block' }))
          }
        }
        return DecorationSet.create(doc, decorations)
      }
      return [
        new Plugin<DecorationSet>({
          key,
          state: {
            init: (_config, state) => compute(state.doc),
            apply: (tr, old) => (tr.docChanged ? compute(tr.doc) : old)
          },
          props: { decorations: (state) => key.getState(state) }
        })
      ]
    }
  })
}

/**
 * Erweiterungen für den Editor und die Leseansicht alter Fassungen.
 * Mit `changesAgainst` werden Unterschiede zu diesem (freigegebenen) Text markiert.
 */
export function createExtensions(articleId: number, changesAgainst?: { baseline: string | null }) {
  return [
    ...(changesAgainst ? [unapprovedBlocks(changesAgainst.baseline)] : []),
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' }
    }),
    Placeholder.configure({ placeholder: 'Hier schreiben … Tipp: [[ verlinkt einen anderen Artikel' }),
    Image.configure({ allowBase64: false }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    createArticleLink(articleId)
  ]
}

export function parseContent(content: string | null): object | string {
  if (!content) return ''
  try {
    return JSON.parse(content) as object
  } catch {
    return ''
  }
}

export function Editor({
  articleId,
  panelId,
  title,
  content,
  editable,
  onStatus,
  unapproved = null,
  baseline = null
}: Props): React.JSX.Element {
  const latest = useRef<{ json: string; text: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const keepTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Fehlgeschlagene Versuche in Folge (0 = alles in Ordnung) */
  const failures = useRef(0)
  /** Liegt eine Sicherheitskopie auf diesem Rechner? */
  const keptLocally = useRef(false)
  const unmounted = useRef(false)
  const titleRef = useRef(title)
  titleRef.current = title
  const key = `article-${articleId}`
  const [extensions] = useState(() =>
    createExtensions(articleId, unapproved === 'changes' ? { baseline } : undefined)
  )

  /** Ungespeicherten Text auf diesem Rechner aufheben (Benutzerordner, nicht die Wiki-Datei). */
  const keepLocally = async (doc: { json: string; text: string }): Promise<void> => {
    try {
      await wiki.keepUnsaved({ articleId: panelId, contentId: articleId, title: titleRef.current, content: doc.json, text: doc.text })
      keptLocally.current = true
    } catch {
      // Benutzerordner nicht beschreibbar – der Text bleibt zumindest im Editor
    }
  }

  // Speichern: entprellt, beim Artikelwechsel/Schließen sofort. Klappt es nicht, bleibt der Text
  // erhalten (Editor + Sicherheitskopie), und MindWiki versucht es von selbst weiter.
  const flush = useRef(async (): Promise<void> => {})
  flush.current = async () => {
    clearTimeout(timer.current)
    timer.current = undefined
    const doc = latest.current
    if (!doc) return
    latest.current = null
    setPending(key, null)
    if (!unmounted.current) onStatus('saving')
    try {
      const result = await wiki.saveArticleContent(articleId, doc.json, doc.text)
      setFailed(key, false)
      clearTimeout(keepTimer.current)
      if (keptLocally.current) {
        keptLocally.current = false
        void wiki.dropUnsaved(articleId).catch(() => undefined)
      }
      if (failures.current > 0) {
        failures.current = 0
        useWiki.getState().toast(`Die Wiki-Datei ist wieder erreichbar – „${titleRef.current}“ ist gespeichert.`)
      }
      if (!unmounted.current && !latest.current) onStatus('saved')
      if (result.treeChanged) await useWiki.getState().loadTree()
    } catch (err) {
      latest.current ??= doc
      const unsaved = latest.current
      await keepLocally(unsaved)
      const s = useWiki.getState()
      if (unmounted.current) {
        // Der Artikel ist schon zu: Der Text liegt in der Sicherheitskopie und lässt sich wiederherstellen
        setFailed(key, false)
        s.toast(
          `„${titleRef.current}“ konnte nicht gespeichert werden. ${errorMessage(err)} Der Text ist auf diesem Rechner aufgehoben – beim nächsten Öffnen des Artikels kannst du ihn wiederherstellen.`,
          'error'
        )
        s.refreshUnsaved()
        return
      }
      setPending(key, () => flush.current())
      setFailed(key, true)
      onStatus('error')
      if (failures.current === 0) {
        s.toast(
          `Speichern nicht möglich: ${errorMessage(err)} Dein Text ist auf diesem Rechner aufgehoben, MindWiki versucht es weiter.`,
          'error'
        )
      }
      const delay = RETRY_DELAYS[Math.min(failures.current, RETRY_DELAYS.length - 1)]
      failures.current += 1
      timer.current = setTimeout(() => void flush.current(), delay)
    }
  }

  const editor = useEditor(
    {
      extensions,
      content: parseContent(content),
      editable,
      editorProps: {
        attributes: { class: 'prose', spellcheck: 'true' },
        handlePaste: (_view, event) => {
          const files = imageFiles(event.clipboardData?.files)
          if (files.length === 0 || !editorRef.current) return false
          void insertImages(editorRef.current, files)
          return true
        },
        handleDrop: (view, event, _slice, moved) => {
          const files = imageFiles(event.dataTransfer?.files)
          if (moved || files.length === 0 || !editorRef.current) return false
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          void insertImages(editorRef.current, files, pos)
          return true
        },
        handleDOMEvents: {
          click: (view, event) => {
            const anchor = (event.target as HTMLElement).closest('a[href]')
            if (!anchor) return false
            event.preventDefault()
            // Im Lesemodus genügt ein Klick, beim Bearbeiten Strg+Klick.
            if (!view.editable || event.ctrlKey || event.metaKey) {
              window.open(anchor.getAttribute('href') ?? '', '_blank')
              return true
            }
            return false
          }
        }
      },
      onUpdate: ({ editor }) => {
        const doc = { json: JSON.stringify(editor.getJSON()), text: editor.getText({ blockSeparator: '\n' }) }
        latest.current = doc
        setPending(key, () => flush.current())
        if (failures.current > 0) {
          // Datei nicht erreichbar: nicht bei jedem Tastendruck neu versuchen (der nächste Versuch ist
          // schon geplant), aber das Getippte gleich in die Sicherheitskopie
          onStatus('error')
          clearTimeout(keepTimer.current)
          keepTimer.current = setTimeout(() => void keepLocally(doc), KEEP_DELAY)
          return
        }
        onStatus('dirty')
        clearTimeout(timer.current)
        timer.current = setTimeout(() => void flush.current(), SAVE_DELAY)
      }
    },
    [articleId]
  )
  const editorRef = useRef(editor)
  editorRef.current = editor

  useEffect(() => {
    // ohne Update-Ereignis, sonst gilt der Artikel fälschlich als geändert
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false)
  }, [editor, editable])

  useEffect(
    () => () => {
      unmounted.current = true
      clearTimeout(keepTimer.current)
      setFailed(key, false)
      void flush.current()
    },
    []
  )

  return (
    <div className={`editor ${editable ? 'editable' : 'readonly'} ${unapproved ? `unapproved unapproved-${unapproved}` : ''}`}>
      {editable && editor && <Toolbar editor={editor} />}
      {unapproved && (
        <div className="unapproved-label">
          <ShieldAlert size={14} />
          {unapproved === 'all' ? 'Text noch nicht freigegeben' : 'Gelb markierte Absätze sind noch nicht freigegeben'}
        </div>
      )}
      <EditorContent editor={editor} className="editor-content" />
    </div>
  )
}

/** Nur-Lese-Ansicht eines Artikeltexts, z. B. einer früheren Fassung. */
export function TextViewer({ articleId, content }: { articleId: number; content: string }): React.JSX.Element {
  const [extensions] = useState(() => createExtensions(articleId))
  const editor = useEditor(
    { extensions, content: parseContent(content), editable: false, editorProps: { attributes: { class: 'prose' } } },
    [content]
  )
  return <EditorContent editor={editor} className="editor-content version-view" />
}
