import { ArrowDown, ArrowUp, CheckCheck, History, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Checklist as ChecklistData, ChecklistItem } from '../../../shared/types'
import { wiki } from '../api'
import { useWiki } from '../store'
import { RunLog } from './RunLog'

export type Act = (fn: () => Promise<unknown>) => Promise<void>

interface Props {
  list: ChecklistData
  first: boolean
  last: boolean
  readMode: boolean
  autoFocusTitle: boolean
  act: Act
}

function ItemRow({
  item,
  index,
  count,
  readMode,
  act,
  onEnter
}: {
  item: ChecklistItem
  index: number
  count: number
  readMode: boolean
  act: Act
  onEnter(): void
}): React.JSX.Element {
  const [text, setText] = useState(item.text)
  useEffect(() => setText(item.text), [item.text])

  const save = (): void => {
    const value = text.trim()
    if (!value) setText(item.text)
    else if (value !== item.text) void act(() => wiki.updateItemText(item.id, value))
  }
  const toggle = (): void => void act(() => wiki.setItemChecked(item.id, !item.checked))

  return (
    <li className={`step ${item.checked ? 'checked' : ''}`}>
      <input type="checkbox" checked={item.checked} onChange={toggle} aria-label={`Schritt ${index + 1} erledigt`} />
      <span className="step-no">{index + 1}.</span>
      {readMode ? (
        <span className="step-text" onClick={toggle}>
          {item.text}
        </span>
      ) : (
        <input
          className="step-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
              onEnter()
            } else if (e.key === 'Escape') {
              setText(item.text)
              ;(e.target as HTMLInputElement).blur()
            } else if (e.key === 'Backspace' && text === '') {
              e.preventDefault()
              void act(() => wiki.deleteItem(item.id))
            }
          }}
        />
      )}
      {item.checked && item.checkedAt && (
        <span className="step-time" title="Abgehakt am">
          {new Date(item.checkedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
      {!readMode && (
        <span className="step-actions">
          <button title="Nach oben" disabled={index === 0} onClick={() => void act(() => wiki.moveItem(item.id, -1))}>
            <ArrowUp size={13} />
          </button>
          <button title="Nach unten" disabled={index === count - 1} onClick={() => void act(() => wiki.moveItem(item.id, 1))}>
            <ArrowDown size={13} />
          </button>
          <button title="Schritt löschen" onClick={() => void act(() => wiki.deleteItem(item.id))}>
            <X size={13} />
          </button>
        </span>
      )}
    </li>
  )
}

export function Checklist({ list, first, last, readMode, autoFocusTitle, act }: Props): React.JSX.Element {
  const [title, setTitle] = useState(list.title)
  const [newStep, setNewStep] = useState('')
  const [completing, setCompleting] = useState(false)
  const [note, setNote] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [runVersion, setRunVersion] = useState(0)
  const titleRef = useRef<HTMLInputElement>(null)
  const addRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => setTitle(list.title), [list.title])
  useEffect(() => {
    if (autoFocusTitle) {
      titleRef.current?.focus()
      titleRef.current?.select()
    }
  }, [autoFocusTitle])

  const total = list.items.length
  const done = list.items.filter((i) => i.checked).length
  const percent = total ? Math.round((done / total) * 100) : 0

  const addStep = async (): Promise<void> => {
    const text = newStep.trim()
    if (!text) return
    setNewStep('')
    await act(() => wiki.addItem(list.id, text))
    addRef.current?.focus()
  }

  const focusAfter = (index: number): void => {
    const inputs = listRef.current?.querySelectorAll<HTMLInputElement>('input.step-text')
    const next = inputs?.[index + 1]
    if (next) next.focus()
    else addRef.current?.focus()
  }

  const reset = async (): Promise<void> => {
    if (done === 0) return
    const ok = await useWiki.getState().confirm({
      title: 'Haken zurücksetzen?',
      message: 'Alle Haken werden entfernt, ohne dass der Durchlauf protokolliert wird.',
      confirmLabel: 'Zurücksetzen'
    })
    if (ok) await act(() => wiki.resetChecklist(list.id))
  }

  const complete = async (): Promise<void> => {
    await act(() => wiki.completeRun(list.id, note))
    setCompleting(false)
    setNote('')
    setRunVersion((v) => v + 1)
    setShowLog(true)
    useWiki.getState().toast('Durchlauf protokolliert, Haken zurückgesetzt.')
  }

  const remove = async (): Promise<void> => {
    const ok = await useWiki.getState().confirm({
      title: 'Ablauf löschen?',
      message: `„${list.title}“ wird mit allen Schritten und dem Protokoll endgültig gelöscht.`,
      confirmLabel: 'Endgültig löschen',
      danger: true
    })
    if (ok) await act(() => wiki.deleteChecklist(list.id))
  }

  return (
    <div className={`checklist ${total > 0 && done === total ? 'complete' : ''}`}>
      <div className="checklist-head">
        {readMode ? (
          <h4 className="checklist-title">{list.title}</h4>
        ) : (
          <input
            ref={titleRef}
            className="checklist-title"
            value={title}
            aria-label="Name des Ablaufs"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() !== list.title && void act(() => wiki.renameChecklist(list.id, title))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addRef.current?.focus()
              }
            }}
          />
        )}
        <span className="checklist-count">
          {done}/{total}
        </span>
        <div className="checklist-actions">
          <button
            className="icon-btn small"
            title="Durchlauf abschließen und protokollieren"
            disabled={total === 0}
            onClick={() => setCompleting((c) => !c)}
          >
            <CheckCheck size={15} />
          </button>
          <button className="icon-btn small" title="Haken zurücksetzen (ohne Protokoll)" disabled={done === 0} onClick={() => void reset()}>
            <RotateCcw size={15} />
          </button>
          <button
            className={`icon-btn small ${showLog ? 'active' : ''}`}
            title="Protokoll anzeigen"
            onClick={() => setShowLog((s) => !s)}
          >
            <History size={15} />
          </button>
          {!readMode && (
            <>
              <button className="icon-btn small" title="Ablauf nach oben" disabled={first} onClick={() => void act(() => wiki.moveChecklist(list.id, -1))}>
                <ArrowUp size={15} />
              </button>
              <button className="icon-btn small" title="Ablauf nach unten" disabled={last} onClick={() => void act(() => wiki.moveChecklist(list.id, 1))}>
                <ArrowDown size={15} />
              </button>
              <button className="icon-btn small danger" title="Ablauf löschen" onClick={() => void remove()}>
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="progress" aria-hidden>
        <div style={{ width: `${percent}%` }} />
      </div>

      <ol className="steps" ref={listRef}>
        {list.items.map((item, i) => (
          <ItemRow
            key={item.id}
            item={item}
            index={i}
            count={total}
            readMode={readMode}
            act={act}
            onEnter={() => focusAfter(i)}
          />
        ))}
      </ol>

      {!readMode && (
        <input
          ref={addRef}
          className="step-add"
          placeholder={total === 0 ? 'Ersten Schritt eingeben und Enter drücken …' : 'Weiteren Schritt hinzufügen …'}
          value={newStep}
          onChange={(e) => setNewStep(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void addStep()
            }
          }}
        />
      )}

      {total > 0 && done === total && !completing && (
        <div className="checklist-done">
          Alle Schritte erledigt.
          <button className="btn btn-primary btn-small" onClick={() => setCompleting(true)}>
            Durchlauf abschließen
          </button>
        </div>
      )}

      {completing && (
        <div className="complete-form">
          <p>
            {done === total
              ? 'Alle Schritte erledigt.'
              : `${done} von ${total} Schritten erledigt – der Durchlauf wird trotzdem protokolliert.`}
          </p>
          <textarea
            placeholder="Notiz zum Durchlauf (optional), z. B. Besonderheiten oder Ticketnummer"
            value={note}
            rows={2}
            autoFocus
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="row-end">
            <button className="btn" onClick={() => setCompleting(false)}>
              Abbrechen
            </button>
            <button className="btn btn-primary" onClick={() => void complete()}>
              Protokollieren &amp; zurücksetzen
            </button>
          </div>
        </div>
      )}

      {showLog && <RunLog checklistId={list.id} version={runVersion} readMode={readMode} />}
    </div>
  )
}
