import { FlaskConical, FolderOpen, LogIn, Plus } from 'lucide-react'
import { useState } from 'react'
import { runAction } from './actions'
import { errorMessage } from './api'
import { useWiki } from './store'

/** Anmeldung mit Benutzername und Passwort – die Benutzer stehen in der Wiki-Datei. */
export function LoginScreen(): React.JSX.Element {
  const dbInfo = useWiki((s) => s.dbInfo)
  const info = useWiki((s) => s.loginInfo)
  const firstRun = !!info?.onlyAdmin && !!info.defaultAdminPassword
  const [username, setUsername] = useState(() => info?.lastUser ?? (firstRun ? 'admin' : ''))
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await useWiki.getState().login(username, password)
    } catch (err) {
      setError(errorMessage(err))
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={(e) => void submit(e)} aria-label="Anmeldung">
        <div className="login-brand">
          <svg className="brand-logo" viewBox="0 0 32 32" aria-hidden>
            <circle cx="16" cy="16" r="6" />
            <circle cx="5" cy="7" r="3" />
            <circle cx="27" cy="7" r="3" />
            <circle cx="27" cy="25" r="3" />
            <path d="M11 13 7 9M21 13l4-4M21 19l4 4" />
          </svg>
          <div>
            <h1>MindWiki</h1>
            <p title={dbInfo?.path}>{dbInfo?.name}</p>
          </div>
        </div>

        <label>
          Benutzername
          <input
            className="text-input"
            value={username}
            autoFocus={!username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Passwort
          <input
            className="text-input"
            type="password"
            value={password}
            autoFocus={!!username}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary login-submit" type="submit" disabled={busy || !username || !password}>
          <LogIn size={15} /> Anmelden
        </button>

        {firstRun && !info?.isSample && (
          <p className="login-hint">
            Erste Anmeldung: Benutzer <strong>admin</strong>, Passwort <strong>admin</strong>. Danach kannst du das
            Passwort ändern und Benutzer anlegen.
          </p>
        )}
        {info?.isSample && (
          <p className="login-hint">
            <FlaskConical size={14} /> Beispiel-Zugänge: <strong>admin</strong> / admin · <strong>Anna</strong> / demo
            (Bearbeiter) · <strong>Ben</strong> / demo (Mitarbeiter)
          </p>
        )}

        <div className="login-links">
          <button type="button" className="link-btn" onClick={() => void runAction('open-db')}>
            <FolderOpen size={13} /> Anderes Wiki öffnen…
          </button>
          <button type="button" className="link-btn" onClick={() => void runAction('new-db')}>
            <Plus size={13} /> Neues Wiki…
          </button>
        </div>
      </form>
    </div>
  )
}
