import { useState } from 'react'
import type { ProxyPrompt } from '../../../shared/types'
import { errorMessage, wiki } from '../api'
import { useWiki } from '../store'
import { Modal } from './Modal'

/** Der Firmen-Proxy verlangt Benutzername und Passwort, damit MindWiki nach Updates suchen kann. */
export function ProxyLoginDialog(): React.JSX.Element | null {
  const prompt = useWiki((s) => s.proxyPrompt)
  if (!prompt) return null
  // Jede neue Abfrage (z. B. nach falschem Passwort) beginnt mit leerem Passwort
  return <ProxyLoginForm key={prompt.attempt} prompt={prompt} />
}

function ProxyLoginForm({ prompt }: { prompt: ProxyPrompt }): React.JSX.Element {
  const [username, setUsername] = useState(prompt.username)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(prompt.canRemember)
  const done = (): void => useWiki.getState().setProxyPrompt(null)
  const fail = (err: unknown): void => useWiki.getState().toast(errorMessage(err), 'error')

  const submit = (): void => {
    if (!username.trim()) return
    done()
    void wiki.answerProxyLogin(username, password, remember).catch(fail)
  }
  const cancel = (): void => {
    done()
    void wiki.cancelProxyLogin().catch(fail)
  }

  return (
    <Modal
      title="Anmeldung am Proxy-Server"
      onClose={cancel}
      footer={
        <>
          <button className="btn" onClick={cancel}>
            Abbrechen
          </button>
          <button className="btn btn-primary" disabled={!username.trim()} onClick={submit}>
            Anmelden
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <p className="proxy-intro">
          MindWiki möchte nach Updates suchen. Der Proxy-Server <strong>{prompt.host}</strong> verlangt dafür eine
          Anmeldung.
          {prompt.realm && <span className="muted"> Bereich: „{prompt.realm}“</span>}
        </p>
        {prompt.failed && (
          <p className="login-error" role="alert">
            Der Proxy hat Benutzername oder Passwort nicht angenommen. Bitte erneut eingeben.
          </p>
        )}
        <label>
          Benutzername
          <input
            className="text-input"
            autoFocus={!prompt.username}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="z. B. FIRMA\benjamin"
          />
        </label>
        <label>
          Passwort
          <input
            className="text-input"
            type="password"
            autoFocus={!!prompt.username}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <p className="muted small proxy-hint">
          Meist dieselben Zugangsdaten wie bei der Windows-Anmeldung – im Zweifel weiß eure IT Bescheid.
        </p>
        {prompt.canRemember && (
          <label className="check-label">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Auf diesem Rechner merken (verschlüsselt für dein Windows-Konto)
          </label>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
