import Image from '@tiptap/extension-image'
import { TableCell, TableHeader, TableRow, Table } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef, useState } from 'react'
import { errorMessage, setPending, wiki } from '../api'
import { useWiki } from '../store'
import { createArticleLink } from './articleLink'
import { imageFiles, insertImages } from './images'
import { Toolbar } from './Toolbar'

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

interface Props {
  articleId: number
  content: string | null
  editable: boolean
  onStatus(status: SaveStatus): void
}

const SAVE_DELAY = 600

/** Erweiterungen für den Editor und die Leseansicht alter Fassungen. */
export function createExtensions(articleId: number) {
  return [
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

export function Editor({ articleId, content, editable, onStatus }: Props): React.JSX.Element {
  const latest = useRef<{ json: string; text: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [extensions] = useState(() => createExtensions(articleId))

  // Speichern: entprellt, beim Artikelwechsel/Schließen sofort.
  const flush = useRef(async (): Promise<void> => {})
  flush.current = async () => {
    clearTimeout(timer.current)
    timer.current = undefined
    const doc = latest.current
    if (!doc) return
    latest.current = null
    setPending(`article-${articleId}`, null)
    onStatus('saving')
    try {
      const result = await wiki.saveArticleContent(articleId, doc.json, doc.text)
      if (!latest.current) onStatus('saved')
      if (result.treeChanged) await useWiki.getState().loadTree()
    } catch (err) {
      latest.current ??= doc
      onStatus('error')
      useWiki.getState().toast(`Speichern fehlgeschlagen: ${errorMessage(err)}`, 'error')
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
        latest.current = { json: JSON.stringify(editor.getJSON()), text: editor.getText({ blockSeparator: '\n' }) }
        onStatus('dirty')
        setPending(`article-${articleId}`, () => flush.current())
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

  useEffect(() => () => void flush.current(), [])

  return (
    <div className={`editor ${editable ? 'editable' : 'readonly'}`}>
      {editable && editor && <Toolbar editor={editor} />}
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
