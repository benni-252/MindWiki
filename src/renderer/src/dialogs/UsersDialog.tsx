import { KeyRound, Trash2, UserPlus, UserX } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ROLE_LABEL, type Role, type UserInfo } from '../../../shared/types'
import { errorMessage, wiki } from '../api'
import { useWiki } from '../store'
import { Modal } from './Modal'

const ROLES: { value: Role; hint: string }[] = [
  { value: 'author', hint: 'verfasst und ändert Artikel' },
  { value: 'editor', hint: 'verfasst und gibt frei' }
]

/** Benutzerverwaltung – nur für den Admin. */
export function UsersDialog(): React.JSX.Element {
  const close = useCallback(() => useWiki.getState().setDialog(null), [])
  const [users, setUsers] = useState<UserInfo[] | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('author')
  const [resetting, setResetting] = useState<number | null>(null)
  const [newPassword, setNewPassword] = useState('')

  const reload = useCallback(async () => setUsers(await wiki.listUsers()), [])
  useEffect(() => {
    reload().catch((err) => useWiki.getState().toast(errorMessage(err), 'error'))
  }, [reload])

  const run = async (fn: () => Promise<unknown>, done?: string): Promise<boolean> => {
    const s = useWiki.getState()
    try {
      await fn()
      await reload()
      await s.loadTree()
      if (done) s.toast(done)
      return true
    } catch (err) {
      s.toast(errorMessage(err), 'error')
      return false
    }
  }

  const add = async (): Promise<void> => {
    const ok = await run(() => wiki.createUser(name, password, role), `Benutzer „${name.trim()}“ angelegt.`)
    if (ok) {
      setName('')
      setPassword('')
    }
  }

  const remove = async (user: UserInfo): Promise<void> => {
    const ok = await useWiki.getState().confirm({
      title: `„${user.username}“ löschen?`,
      message:
        'Der Benutzer kann sich danach nicht mehr anmelden. Seine Artikel bleiben erhalten und werden als „Autor gelöscht“ gekennzeichnet.',
      confirmLabel: 'Löschen',
      danger: true
    })
    if (ok) await run(() => wiki.deleteUser(user.id), `„${user.username}“ gelöscht.`)
  }

  return (
    <Modal
      title="Benutzer verwalten"
      onClose={close}
      wide
      footer={
        <button className="btn btn-primary" onClick={close}>
          Fertig
        </button>
      }
    >
      <table className="users-table">
        <thead>
          <tr>
            <th>Benutzer</th>
            <th>Rolle</th>
            <th aria-label="Aktionen" />
          </tr>
        </thead>
        <tbody>
          {users?.map((u) => (
            <tr key={u.id} className={u.deleted ? 'deleted' : ''}>
              <td>
                {u.deleted && <UserX size={14} />} <strong>{u.username}</strong>
                {u.deleted && <small className="muted"> (gelöscht)</small>}
              </td>
              <td>
                {u.role === 'admin' || u.deleted ? (
                  ROLE_LABEL[u.role]
                ) : (
                  <select
                    className="tb-select"
                    value={u.role}
                    aria-label={`Rolle von ${u.username}`}
                    onChange={(e) => void run(() => wiki.setUserRole(u.id, e.target.value as Role), 'Rolle geändert.')}
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {ROLE_LABEL[r.value]}
                      </option>
                    ))}
                  </select>
                )}
              </td>
              <td className="users-actions">
                {!u.deleted && resetting !== u.id && (
                  <button className="btn btn-small" onClick={() => setResetting(u.id)}>
                    <KeyRound size={13} /> Passwort
                  </button>
                )}
                {resetting === u.id && (
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void run(() => wiki.resetPassword(u.id, newPassword), 'Passwort gesetzt.').then((ok) => {
                        if (ok) {
                          setResetting(null)
                          setNewPassword('')
                        }
                      })
                    }}
                  >
                    <input
                      className="text-input"
                      type="password"
                      autoFocus
                      placeholder="Neues Passwort"
                      aria-label={`Neues Passwort für ${u.username}`}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <button className="btn btn-small btn-primary" type="submit" disabled={!newPassword}>
                      Setzen
                    </button>
                  </form>
                )}
                {!u.deleted && u.role !== 'admin' && (
                  <button className="icon-btn small danger" title={`${u.username} löschen`} onClick={() => void remove(u)}>
                    <Trash2 size={15} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form
        className="users-add"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <h4 className="change-day">Neuer Benutzer</h4>
        <div className="users-add-row">
          <input
            className="text-input"
            placeholder="Benutzername"
            aria-label="Benutzername"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="text-input"
            type="password"
            placeholder="Passwort"
            aria-label="Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <select className="tb-select" aria-label="Rolle" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {ROLE_LABEL[r.value]} – {r.hint}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" type="submit" disabled={!name.trim() || !password}>
            <UserPlus size={14} /> Anlegen
          </button>
        </div>
      </form>
      <p className="muted small">
        Gelöschte Benutzer können sich nicht mehr anmelden. Ihre Artikel bleiben erhalten und sind als „Autor gelöscht“
        gekennzeichnet. Die Anmeldung schützt vor Versehen im Team, nicht die Datei selbst – wer die Datei direkt
        öffnen kann, kommt an den Inhalt.
      </p>
    </Modal>
  )
}
