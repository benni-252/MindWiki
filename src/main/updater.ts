import { app, net, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/types'
import { isNewerVersion } from '../shared/version'

// Updates kommen aus den GitHub-Releases (siehe publish in electron-builder.yml).
const RELEASES_PAGE = 'https://github.com/benni-252/MindWiki/releases/latest'
const LATEST_API = 'https://api.github.com/repos/benni-252/MindWiki/releases/latest'
const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 6 * 60 * 60_000

type Mode = 'installed' | 'portable' | 'off'

let state: UpdateState = { status: 'idle', current: app.getVersion() }
let notify: (state: UpdateState) => void = () => undefined
let prepareQuit: () => void = () => undefined
/** Automatische Prüfungen im Hintergrund melden Fehler nicht (offline, Repository privat …). */
let quiet = true

/** Installiert (NSIS) → selbst aktualisieren; portable → nur Hinweis; Entwicklung/andere Systeme → aus. */
function mode(): Mode {
  if (!app.isPackaged || process.platform !== 'win32') return 'off'
  return process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' : 'installed'
}

function set(next: Omit<UpdateState, 'current'>): void {
  state = { ...next, current: app.getVersion() }
  notify(state)
}

function explain(err: unknown): string {
  const text = String(err instanceof Error ? err.message : err)
  if (/\b404\b|Not Found/i.test(text)) {
    return 'Auf GitHub wurden keine Update-Informationen gefunden. Ist das Repository öffentlich?'
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|offline/i.test(text)) return 'GitHub ist gerade nicht erreichbar.'
  return `Die Update-Prüfung ist fehlgeschlagen: ${text.split('\n')[0]}`
}

function failed(err: unknown): void {
  if (quiet) {
    state = { status: 'idle', current: app.getVersion() }
    return
  }
  set({ status: 'error', message: explain(err) })
}

export function initUpdater(onState: (state: UpdateState) => void, beforeQuit: () => void): void {
  notify = onState
  prepareQuit = beforeQuit
  const m = mode()
  if (m === 'off') return
  if (m === 'installed') {
    autoUpdater.autoDownload = false
    // Ein geladenes Update wird spätestens beim Beenden installiert
    autoUpdater.autoInstallOnAppQuit = true
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
  setTimeout(() => void checkForUpdates(true), FIRST_CHECK_MS)
  setInterval(() => void checkForUpdates(true), CHECK_EVERY_MS)
}

async function latestReleaseVersion(): Promise<string> {
  const res = await net.fetch(LATEST_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MindWiki' }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { tag_name?: string }
  if (!json.tag_name) throw new Error('Keine Versionsangabe')
  return json.tag_name.replace(/^v/i, '')
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
  if (!background) set({ status: 'checking' })
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
