import { app, net, safeStorage, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ProxyPrompt, UpdateState } from '../shared/types'
import { isNewerVersion } from '../shared/version'
import { ProxyLogin, type LoginCallback, type ProxyCredentials, type ProxyVault } from './proxyLogin'
import { explainUpdateError } from './updateErrors'
import { loadSettings, saveSettings } from './settings'

// Updates kommen aus den GitHub-Releases (siehe publish in electron-builder.yml).
const RELEASES_PAGE = 'https://github.com/benni-252/MindWiki/releases/latest'
const LATEST_API = 'https://api.github.com/repos/benni-252/MindWiki/releases/latest'
const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 6 * 60 * 60_000

type Mode = 'installed' | 'portable' | 'off'

let state: UpdateState = { status: 'idle', current: app.getVersion() }
let notify: (state: UpdateState) => void = () => undefined
let showProxyPrompt: (prompt: ProxyPrompt | null) => boolean = () => false
let prepareQuit: () => void = () => undefined
/** Automatische Prüfungen im Hintergrund melden Fehler nicht (offline, Repository privat …). */
let quiet = true

/** Nur für automatische Tests: Versionsabfrage an diese Adresse (wie die portable Version). */
const testUrl = (): string | undefined => process.env.MINDWIKI_UPDATE_URL || undefined

/** Installiert (NSIS) → selbst aktualisieren; portable → nur Hinweis; Entwicklung/andere Systeme → aus. */
function mode(): Mode {
  if (testUrl()) return 'portable'
  if (!app.isPackaged || process.platform !== 'win32') return 'off'
  return process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' : 'installed'
}

// ── Anmeldung am Firmen-Proxy ────────────────────────────────────────────────

/** Gemerkte Proxy-Anmeldungen: Passwort mit safeStorage (unter Windows an das Windows-Konto gebunden). */
const vault: ProxyVault = {
  canRemember: () => {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  },
  load: (key) => {
    const entry = loadSettings().proxyLogins?.[key]
    if (!entry || !vault.canRemember()) return null
    try {
      return { username: entry.username, password: safeStorage.decryptString(Buffer.from(entry.password, 'base64')) }
    } catch {
      return null
    }
  },
  save: (key, credentials: ProxyCredentials | null) => {
    const logins = { ...loadSettings().proxyLogins }
    if (credentials) {
      logins[key] = {
        username: credentials.username,
        password: safeStorage.encryptString(credentials.password).toString('base64')
      }
    } else {
      delete logins[key]
    }
    saveSettings({ proxyLogins: logins })
  }
}

const proxy = new ProxyLogin({ ask: (prompt) => showProxyPrompt(prompt), vault, now: () => Date.now() })

export function answerProxyLogin(username: string, password: string, remember: boolean): void {
  proxy.answer(username, password, remember)
}

export function cancelProxyLogin(): void {
  proxy.cancel()
}

export function getProxyPrompt(): ProxyPrompt | null {
  return proxy.current()
}

export function getSavedProxyLogins(): string[] {
  return Object.keys(loadSettings().proxyLogins ?? {})
}

export function forgetProxyLogins(): void {
  proxy.forget(getSavedProxyLogins())
}

// ── Update-Prüfung ───────────────────────────────────────────────────────────

function set(next: Omit<UpdateState, 'current'>): void {
  state = { ...next, current: app.getVersion() }
  notify(state)
}

function failed(err: unknown): void {
  if (quiet) {
    state = { status: 'idle', current: app.getVersion() }
    return
  }
  set({ status: 'error', message: explainUpdateError(err) })
}

export function initUpdater(
  onState: (state: UpdateState) => void,
  beforeQuit: () => void,
  onProxyPrompt: (prompt: ProxyPrompt | null) => boolean
): void {
  notify = onState
  prepareQuit = beforeQuit
  showProxyPrompt = onProxyPrompt
  const m = mode()
  if (m === 'off') return
  if (m === 'installed') {
    autoUpdater.autoDownload = false
    // Ein geladenes Update wird spätestens beim Beenden installiert
    autoUpdater.autoInstallOnAppQuit = true
    // Proxy mit Anmeldung: ohne Antwort hinge die Prüfung für immer
    // (electron-updater reicht Electrons Rückruf durch; ohne Argumente bricht er die Anmeldung ab)
    autoUpdater.on('login', (authInfo, callback) => proxy.handle(authInfo, callback as LoginCallback))
    autoUpdater.on('update-available', (info) => set({ status: 'available', version: info.version, canInstall: true }))
    autoUpdater.on('update-not-available', () => {
      if (quiet) state = { status: 'idle', current: app.getVersion() }
      else set({ status: 'current' })
    })
    autoUpdater.on('download-progress', (p) =>
      set({ status: 'downloading', version: state.version, canInstall: true, percent: Math.round(p.percent) })
    )
    autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, canInstall: true }))
    autoUpdater.on('error', failed)
  }
  // In automatischen Tests nur auf Anforderung prüfen (sonst platzt die Prüfung im Hintergrund in den Test)
  if (testUrl()) return
  setTimeout(() => void checkForUpdates(true), FIRST_CHECK_MS)
  setInterval(() => void checkForUpdates(true), CHECK_EVERY_MS)
}

/** Neueste Version laut GitHub (portable Version) – über die Proxy-Einstellungen von Windows. */
function latestReleaseVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url: testUrl() ?? LATEST_API })
    request.setHeader('Accept', 'application/vnd.github+json')
    request.setHeader('User-Agent', 'MindWiki')
    request.on('login', (authInfo, callback) => proxy.handle(authInfo, callback))
    request.on('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('error', reject)
      response.on('end', () => {
        if (response.statusCode !== 200) {
          // Hinter einem gemeinsamen Proxy teilen sich alle Rechner GitHubs Grenze von 60 Abfragen pro Stunde
          const limited = /rate limit/i.test(Buffer.concat(chunks).toString('utf8'))
          reject(new Error(limited ? 'GitHub rate limit' : `HTTP ${response.statusCode}`))
          return
        }
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { tag_name?: string }
          if (!json.tag_name) throw new Error('Keine Versionsangabe')
          resolve(json.tag_name.replace(/^v/i, ''))
        } catch (err) {
          reject(err)
        }
      })
    })
    request.on('error', reject)
    request.end()
  })
}

export function getUpdateState(): UpdateState {
  return mode() === 'off' ? { status: 'unsupported', current: app.getVersion() } : state
}

export async function checkForUpdates(background = false): Promise<UpdateState> {
  const m = mode()
  if (m === 'off') return getUpdateState()
  // Läuft schon ein Download oder ist ein Update bereit, nichts neu anstoßen
  if (state.status === 'downloading' || state.status === 'ready') return state
  quiet = background
  if (!background) {
    proxy.allowPrompt()
    set({ status: 'checking' })
  }
  try {
    if (m === 'installed') {
      await autoUpdater.checkForUpdates()
    } else {
      const latest = await latestReleaseVersion()
      if (isNewerVersion(latest, app.getVersion())) set({ status: 'available', version: latest, canInstall: false })
      else if (!background) set({ status: 'current' })
    }
  } catch (err) {
    failed(err)
  }
  return state
}

export async function downloadUpdate(): Promise<void> {
  if (mode() !== 'installed' || state.status !== 'available') return
  quiet = false
  proxy.allowPrompt()
  set({ status: 'downloading', version: state.version, canInstall: true, percent: 0 })
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    failed(err)
  }
}

/** Beendet MindWiki, installiert das geladene Update still und startet neu. */
export function installUpdate(): void {
  if (mode() !== 'installed' || state.status !== 'ready') return
  prepareQuit()
  autoUpdater.quitAndInstall(true, true)
}

export function openReleasePage(): void {
  void shell.openExternal(RELEASES_PAGE)
}
