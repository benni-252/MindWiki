import { useEditorState, type Editor } from '@tiptap/react'
import {
  Bold,
  Code,
  FileSymlink,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Table as TableIcon,
  Underline,
  Undo2
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { insertImages } from './images'

function Btn({
  title,
  active,
  disabled,
  onClick,
  children
}: {
  title: string
  active?: boolean
  disabled?: boolean
  onClick(): void
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`tb-btn ${active ? 'active' : ''}`}
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function LinkPopover({ editor, onClose }: { editor: Editor; onClose(): void }): React.JSX.Element {
  const [href, setHref] = useState((editor.getAttributes('link').href as string | undefined) ?? 'https://')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const apply = (): void => {
    const value = href.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (!value || value === 'https://') chain.unsetLink().run()
    else if (editor.state.selection.empty && !editor.isActive('link')) {
      editor.chain().focus().insertContent({ type: 'text', text: value, marks: [{ type: 'link', attrs: { href: value } }] }).run()
    } else chain.setLink({ href: value }).run()
    onClose()
  }

  return (
    <div className="popover">
      <input
        ref={ref}
        value={href}
        placeholder="https://…"
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply()
          if (e.key === 'Escape') onClose()
        }}
      />
      <button className="btn btn-primary" onClick={apply}>
        Übernehmen
      </button>
      {editor.isActive('link') && (
        <button
          className="btn"
          onClick={() => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            onClose()
          }}
        >
          Entfernen
        </button>
      )}
    </div>
  )
}

export function Toolbar({ editor }: { editor: Editor }): React.JSX.Element {
  const [linkOpen, setLinkOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive('heading', { level: 1 })
        ? 'h1'
        : e.isActive('heading', { level: 2 })
          ? 'h2'
          : e.isActive('heading', { level: 3 })
            ? 'h3'
            : 'p',
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'),
      table: e.isActive('table'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo()
    })
  })
  const chain = () => editor.chain().focus()

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatierung">
      <Btn title="Rückgängig (Strg+Z)" disabled={!state.canUndo} onClick={() => chain().undo().run()}>
        <Undo2 size={16} />
      </Btn>
      <Btn title="Wiederholen (Strg+Y)" disabled={!state.canRedo} onClick={() => chain().redo().run()}>
        <Redo2 size={16} />
      </Btn>
      <span className="tb-sep" />
      <select
        className="tb-select"
        value={state.block}
        title="Absatzformat"
        onChange={(e) => {
          const v = e.target.value
          if (v === 'p') chain().setParagraph().run()
          else chain().setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run()
        }}
      >
        <option value="p">Text</option>
        <option value="h1">Überschrift 1</option>
        <option value="h2">Überschrift 2</option>
        <option value="h3">Überschrift 3</option>
      </select>
      <span className="tb-sep" />
      <Btn title="Fett (Strg+B)" active={state.bold} onClick={() => chain().toggleBold().run()}>
        <Bold size={16} />
      </Btn>
      <Btn title="Kursiv (Strg+I)" active={state.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic size={16} />
      </Btn>
      <Btn title="Unterstrichen (Strg+U)" active={state.underline} onClick={() => chain().toggleUnderline().run()}>
        <Underline size={16} />
      </Btn>
      <Btn title="Durchgestrichen" active={state.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough size={16} />
      </Btn>
      <Btn title="Code im Text" active={state.code} onClick={() => chain().toggleCode().run()}>
        <Code size={16} />
      </Btn>
      <span className="tb-sep" />
      <Btn title="Aufzählung" active={state.bullet} onClick={() => chain().toggleBulletList().run()}>
        <List size={16} />
      </Btn>
      <Btn title="Nummerierte Liste" active={state.ordered} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered size={16} />
      </Btn>
      <Btn title="Zitat" active={state.quote} onClick={() => chain().toggleBlockquote().run()}>
        <Quote size={16} />
      </Btn>
      <Btn title="Codeblock" active={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
        <SquareCode size={16} />
      </Btn>
      <Btn title="Trennlinie" onClick={() => chain().setHorizontalRule().run()}>
        <Minus size={16} />
      </Btn>
      <span className="tb-sep" />
      <span className="tb-anchor">
        <Btn title="Weblink" active={state.link} onClick={() => setLinkOpen((o) => !o)}>
          <LinkIcon size={16} />
        </Btn>
        {linkOpen && <LinkPopover editor={editor} onClose={() => setLinkOpen(false)} />}
      </span>
      <Btn title="Artikel verlinken ([[)" onClick={() => chain().insertContent('[[').run()}>
        <FileSymlink size={16} />
      </Btn>
      <Btn title="Bild einfügen (oder Strg+V / hineinziehen)" onClick={() => fileInput.current?.click()}>
        <ImagePlus size={16} />
      </Btn>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          void insertImages(editor, files)
        }}
      />
      <Btn
        title="Tabelle einfügen"
        active={state.table}
        onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <TableIcon size={16} />
      </Btn>
      {state.table && (
        <span className="tb-table">
          <button type="button" onClick={() => chain().addRowAfter().run()}>+ Zeile</button>
          <button type="button" onClick={() => chain().addColumnAfter().run()}>+ Spalte</button>
          <button type="button" onClick={() => chain().deleteRow().run()}>− Zeile</button>
          <button type="button" onClick={() => chain().deleteColumn().run()}>− Spalte</button>
          <button type="button" onClick={() => chain().toggleHeaderRow().run()}>Kopfzeile</button>
          <button type="button" className="danger" onClick={() => chain().deleteTable().run()}>
            Tabelle löschen
          </button>
        </span>
      )}
    </div>
  )
}
