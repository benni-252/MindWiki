import { useCallback, useState } from 'react'
import { errorMessage, wiki } from '../api'
import { useWiki } from '../store'
import { Modal } from './Modal'

export function ChangePasswordDialog(): React.JSX.Element {
  const close = useCallback(() => useWiki.getState().setDialog(null), [])
  const [old, setOld] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    if (next !== repeat) {
      setError('Die beiden neuen Passwörter stimmen nicht überein.')
      return
    }
    try {
      await wiki.changePassword(old, next)
      close()
      const s = useWiki.getState()
      s.toast('Passwort geändert.')
      await s.refreshLoginInfo()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Modal
      title="Passwort ändern"
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Abbrechen
          </button>
          <button className="btn btn-primary" disabled={!old || !next} onClick={() => void save()}>
            Speichern
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <label>
          Bisheriges Passwort
          <input className="text-input" type="password" autoFocus value={old} onChange={(e) => setOld(e.target.value)} />
        </label>
        <label>
          Neues Passwort
          <input className="text-input" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label>
          Neues Passwort wiederholen
          <input className="text-input" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
