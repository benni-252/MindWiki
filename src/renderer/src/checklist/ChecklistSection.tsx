import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Checklist as ChecklistData } from '../../../shared/types'
import { errorMessage, wiki } from '../api'
import { useWiki } from '../store'
import { Checklist, type Act } from './Checklist'

/** Abschnitt „Abläufe“ eines Artikels: beliebig viele abhakbare Checklisten. */
export function ChecklistSection({ articleId, readMode }: { articleId: number; readMode: boolean }): React.JSX.Element | null {
  const [lists, setLists] = useState<ChecklistData[] | null>(null)
  const [focusId, setFocusId] = useState<number | null>(null)

  const reload = useCallback(async () => {
    setLists(await wiki.getChecklists(articleId))
  }, [articleId])

  useEffect(() => {
    setLists(null)
    reload().catch((err) => useWiki.getState().toast(errorMessage(err), 'error'))
  }, [reload])

  // Nach jeder Änderung neu laden; der Baum wird für die Fortschrittsanzeige in der Mind Map aktualisiert.
  const act: Act = useCallback(
    async (fn) => {
      try {
        await fn()
        await reload()
        await useWiki.getState().loadTree()
      } catch (err) {
        useWiki.getState().toast(errorMessage(err), 'error')
      }
    },
    [reload]
  )

  const addList = async (): Promise<void> => {
    try {
      const id = await wiki.createChecklist(articleId, 'Neuer Ablauf')
      setFocusId(id)
      await reload()
    } catch (err) {
      useWiki.getState().toast(errorMessage(err), 'error')
    }
  }

  if (!lists) return null
  if (readMode && lists.length === 0) return null

  return (
    <section className="panel-section">
      <div className="section-head">
        <h3>Abläufe</h3>
        {!readMode && (
          <button className="btn btn-small" onClick={() => void addList()}>
            <Plus size={14} /> Ablauf
          </button>
        )}
      </div>
      {lists.length === 0 && (
        <p className="muted small">
          Noch keine Abläufe. Mit „+ Ablauf“ legst du eine Schritt-für-Schritt-Checkliste an, die du beim Durchführen
          abhaken kannst – abgeschlossene Durchläufe werden mit Datum protokolliert.
        </p>
      )}
      {lists.map((list, i) => (
        <Checklist
          key={list.id}
          list={list}
          first={i === 0}
          last={i === lists.length - 1}
          readMode={readMode}
          autoFocusTitle={focusId === list.id}
          act={act}
        />
      ))}
    </section>
  )
}
