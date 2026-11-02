import { useCallback, useState } from 'react'
import { useWiki } from '../store'
import { Modal } from './Modal'

/** Name, unter dem die eigenen Änderungen im Verlauf erscheinen. */
export function UserNameDialog(): React.JSX.Element {
  const current = useWiki((s) => s.userName)
  const [value, setValue] = useState(current)
  const close = useCallback(() => useWiki.getState().setDialog(null), [])

  const save = async (): Promise<void> => {
    close()
    if (value.trim() !== current) await useWiki.getState().setUserName(value)
  }

  return (
    <Modal
      title="Dein Name im Verlauf"
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={() => void save()}>
            Speichern
          </button>
        </>
      }
    >
      <p className="muted small">
        So sehen die anderen, wer etwas geändert hat. Leer lassen, um den Windows-Benutzernamen zu verwenden.
      </p>
      <input
        className="text-input"
        autoFocus
        value={value}
        maxLength={60}
        aria-label="Dein Name"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
        }}
      />
    </Modal>
  )
}
