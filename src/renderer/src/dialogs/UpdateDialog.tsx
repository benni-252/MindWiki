import { Download, ExternalLink, KeyRound, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { errorMessage, flushPending, wiki } from '../api'
import { useWiki } from '../store'
import { Modal } from './Modal'

/** Neue Version von GitHub: anzeigen, herunterladen, installieren. */
export function UpdateDialog(): React.JSX.Element {
  const update = useWiki((s) => s.update)
  const close = useCallback(() => useWiki.getState().setDialog(null), [])
  const fail = (err: unknown): void => useWiki.getState().toast(errorMessage(err), 'error')
  const proxyPrompt = useWiki((s) => s.proxyPrompt)
  const [savedProxies, setSavedProxies] = useState<string[]>([])

  // Gemerkte Proxy-Anmeldungen (neu lesen, sobald eine Abfrage beantwortet wurde)
  useEffect(() => {
    if (proxyPrompt) return
    let active = true
    wiki
      .getSavedProxyLogins()
      .then((hosts) => active && setSavedProxies(hosts))
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [proxyPrompt, update.status])

  const forgetProxies = async (): Promise<void> => {
    try {
      await wiki.forgetProxyLogins()
      setSavedProxies([])
      useWiki.getState().toast('Gespeicherte Proxy-Anmeldung gelöscht.')
    } catch (err) {
      fail(err)
    }
  }

  const download = (): void => void wiki.downloadUpdate().catch(fail)
  const install = async (): Promise<void> => {
    await flushPending()
    await wiki.installUpdate()
  }
  const openPage = (): void => void wiki.openReleasePage().catch(fail)

  const footer = (
    <>
      {(update.status === 'available' || update.status === 'error') && (
        <button className="btn footer-left" onClick={openPage}>
          <ExternalLink size={14} /> {update.status === 'error' ? 'Download-Seite öffnen' : 'Was ist neu?'}
        </button>
      )}
      {update.status === 'available' && update.canInstall && (
        <button className="btn btn-primary" onClick={download}>
          <Download size={14} /> Herunterladen und installieren
        </button>
      )}
      {update.status === 'available' && !update.canInstall && (
        <button className="btn btn-primary" onClick={openPage}>
          <Download size={14} /> Download-Seite öffnen
        </button>
      )}
      {update.status === 'ready' && (
        <>
          <button className="btn" onClick={close}>
            Später
          </button>
          <button className="btn btn-primary" onClick={() => void install()}>
            <RefreshCw size={14} /> Jetzt neu starten
          </button>
        </>
      )}
      {update.status !== 'ready' && (
        <button className={`btn ${update.status === 'available' ? '' : 'btn-primary'}`} onClick={close}>
          Schließen
        </button>
      )}
    </>
  )

  return (
    <Modal title="Updates" onClose={close} footer={footer} wide>
      {update.status === 'checking' && <p>Suche nach einer neuen Version …</p>}
      {(update.status === 'current' || update.status === 'idle') && (
        <p>Du hast die neueste Version ({update.current}).</p>
      )}
      {update.status === 'available' && (
        <>
          <p>
            <strong>Version {update.version}</strong> ist verfügbar – du hast {update.current}.
          </p>
          <p className="muted small">
            {update.canInstall
              ? 'MindWiki lädt das Update herunter und startet zum Installieren kurz neu. Deine Daten bleiben erhalten.'
              : 'Du benutzt die portable Version. Lade die neue .exe von der Download-Seite und ersetze die alte.'}
          </p>
        </>
      )}
      {update.status === 'downloading' && (
        <>
          <p>Version {update.version} wird heruntergeladen …</p>
          <div className="progress update-progress">
            <div style={{ width: `${update.percent ?? 0}%` }} />
          </div>
          <p className="muted small">{update.percent ?? 0} %</p>
        </>
      )}
      {update.status === 'ready' && (
        <p>
          Version {update.version} ist bereit. MindWiki startet zum Installieren kurz neu – oder installiert das Update
          beim nächsten Beenden.
        </p>
      )}
      {update.status === 'error' && <p>{update.message}</p>}
      {update.status === 'unsupported' && (
        <p>Updates gibt es nur in der installierten Windows-Version (du hast {update.current}).</p>
      )}
      {(update.status === 'available' || update.status === 'ready') && (
        <p className="muted small">Benutzt ihr eine gemeinsame Wiki-Datei, sollten alle auf die neue Version wechseln.</p>
      )}
      {savedProxies.length > 0 && (
        <p className="muted small proxy-saved">
          <KeyRound size={14} />
          <span>Anmeldung für den Proxy {savedProxies.join(', ')} ist gespeichert.</span>
          <button className="link-btn" onClick={() => void forgetProxies()}>
            Löschen
          </button>
        </p>
      )}
    </Modal>
  )
}
