import { ArrowDown, ArrowUp, Copy, ExternalLink, Plus, ShieldAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SECRET_LABEL } from '../../../shared/templates'
import type { ArticleField } from '../../../shared/types'
import { errorMessage, wiki } from '../api'
import { useWiki } from '../store'

const SUGGESTIONS = [
  'Hostname',
  'IP-Adresse',
  'Subnetz',
  'Gateway',
  'DNS',
  'MAC-Adresse',
  'VLAN',
  'Betriebssystem',
  'Version',
  'Hersteller',
  'Modell',
  'Seriennummer',
  'Inventarnummer',
  'Standort',
  'Raum / Rack',
  'Ansprechpartner',
  'Telefon',
  'E-Mail',
  'URL',
  'Lizenz',
  'Lizenz gültig bis',
  'Garantie bis',
  'Kaufdatum',
  'Wartungsfenster',
  'Backup',
  'Kundennummer',
  'Vertrag / SLA'
]

const isUrl = (v: string): boolean => /^https?:\/\/\S+$/i.test(v)
const isMail = (v: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)
/** IP-, MAC- und Netzangaben in Festbreitenschrift */
const isTechnical = (v: string): boolean => /^[\d.:/a-f-]+$/i.test(v) && /\d/.test(v)

function copy(value: string): void {
  navigator.clipboard
    .writeText(value)
    .then(() => useWiki.getState().toast(`„${value}“ kopiert.`))
    .catch(() => useWiki.getState().toast('Kopieren nicht möglich.', 'error'))
}

function Value({ value }: { value: string }): React.JSX.Element {
  if (isUrl(value)) {
    return (
      <a
        href={value}
        onClick={(e) => {
          e.preventDefault()
          window.open(value, '_blank')
        }}
      >
        {value}
      </a>
    )
  }
  if (isMail(value)) return <a href={`mailto:${value}`}>{value}</a>
  return <span className={isTechnical(value) ? 'mono' : ''}>{value}</span>
}

type Act = (fn: () => Promise<unknown>) => Promise<void>

function FieldRow({
  field,
  index,
  count,
  readMode,
  autoFocus,
  act
}: {
  field: ArticleField
  index: number
  count: number
  readMode: boolean
  autoFocus: boolean
  act: Act
}): React.JSX.Element {
  const [label, setLabel] = useState(field.label)
  const [value, setValue] = useState(field.value)
  const labelRef = useRef<HTMLInputElement>(null)

  useEffect(() => setLabel(field.label), [field.label])
  useEffect(() => setValue(field.value), [field.value])
  useEffect(() => {
    if (autoFocus) {
      labelRef.current?.focus()
      labelRef.current?.select()
    }
  }, [autoFocus])

  const save = (): void => {
    if (label.trim() === field.label && value.trim() === field.value) return
    void act(() => wiki.updateField(field.id, label, value))
  }
  const secret = SECRET_LABEL.test(label) && value.trim() !== ''

  if (readMode) {
    return (
      <>
        <div className="fs-label">{field.label}</div>
        <div className="fs-value">
          <Value value={field.value} />
          <button className="fs-copy" title="Kopieren" onClick={() => copy(field.value)}>
            <Copy size={13} />
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <input
        ref={labelRef}
        className="fs-label"
        value={label}
        list="mindwiki-field-suggestions"
        aria-label="Feldname"
        onChange={(e) => setLabel(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.currentTarget.nextElementSibling?.querySelector('input') as HTMLInputElement | null)?.focus()
          }
        }}
      />
      <div className="fs-value">
        <input
          value={value}
          placeholder="—"
          aria-label={`Wert für ${label}`}
          className={isTechnical(value) ? 'mono' : ''}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setValue(field.value)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
        <span className="fs-actions">
          {isUrl(value) && (
            <button title="Im Browser öffnen" onClick={() => window.open(value, '_blank')}>
              <ExternalLink size={13} />
            </button>
          )}
          <button title="Kopieren" disabled={!value} onClick={() => copy(value)}>
            <Copy size={13} />
          </button>
          <button title="Nach oben" disabled={index === 0} onClick={() => void act(() => wiki.moveField(field.id, -1))}>
            <ArrowUp size={13} />
          </button>
          <button title="Nach unten" disabled={index === count - 1} onClick={() => void act(() => wiki.moveField(field.id, 1))}>
            <ArrowDown size={13} />
          </button>
          <button title="Feld löschen" onClick={() => void act(() => wiki.deleteField(field.id))}>
            <X size={13} />
          </button>
        </span>
      </div>
      {secret && (
        <div className="fs-warning">
          <ShieldAlert size={14} />
          Passwörter besser im Passwort-Manager speichern – die Wiki-Datei ist nicht verschlüsselt.
        </div>
      )}
    </>
  )
}

/** Steckbrief: frei benennbare Felder wie Hostname, IP-Adresse, Standort. */
export function FactSheet({
  articleId,
  fields,
  readMode,
  reload
}: {
  articleId: number
  fields: ArticleField[]
  readMode: boolean
  reload(): Promise<void>
}): React.JSX.Element | null {
  const [focusId, setFocusId] = useState<number | null>(null)

  const act: Act = async (fn) => {
    try {
      await fn()
      await reload()
    } catch (err) {
      useWiki.getState().toast(errorMessage(err), 'error')
    }
  }

  const add = async (): Promise<void> => {
    try {
      const id = await wiki.addField(articleId, 'Neues Feld')
      setFocusId(id)
      await reload()
    } catch (err) {
      useWiki.getState().toast(errorMessage(err), 'error')
    }
  }

  const visible = readMode ? fields.filter((f) => f.value.trim() !== '') : fields
  if (visible.length === 0) {
    if (readMode) return null
    return (
      <button className="fs-add-empty" onClick={() => void add()}>
        <Plus size={14} /> Steckbrief-Feld (z. B. Hostname, IP-Adresse)
      </button>
    )
  }

  return (
    <section className={`factsheet ${readMode ? 'read' : 'edit'}`} aria-label="Steckbrief">
      <div className="fs-head">
        <h3>Steckbrief</h3>
        {!readMode && (
          <button className="btn btn-small" onClick={() => void add()}>
            <Plus size={14} /> Feld
          </button>
        )}
      </div>
      <div className="fs-grid">
        {visible.map((field, i) => (
          <FieldRow
            key={field.id}
            field={field}
            index={i}
            count={visible.length}
            readMode={readMode}
            autoFocus={focusId === field.id}
            act={act}
          />
        ))}
      </div>
      <datalist id="mindwiki-field-suggestions">
        {SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </section>
  )
}
