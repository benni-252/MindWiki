import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { RPC_METHODS, type Role, type WikiRpc } from '../shared/types'
import { backupTo, NotAWikiError } from './db'
import { ensureSampleWiki } from './sample'
import { checkForUpdates, downloadUpdate, getUpdateState, installUpdate, openReleasePage } from './updater'
import { defaultDbPath, loadSettings, sampleDbPath, saveSettings } from './settings'
import { WikiError, type WikiStore } from './store'
import { currentDbFile, currentSession, currentStore, openWiki, setSession, wikiName } from './wiki'

type FileOps =
  | 'getDbInfo'
  | 'openSampleDb'
  | 'getUpdateState'
  | 'checkForUpdates'
  | 'downloadUpdate'
  | 'installUpdate'
  | 'openReleasePage'
  | 'newDb'
  | 'openDb'
  | 'backupDb'
  | 'revealDb'
  | 'confirmClose'
  | 'getUserName'
  | 'getLoginInfo'
  | 'login'
  | 'logout'
  | 'changePassword'

// Bricht die Typprüfung, wenn WikiStore eine Datenmethode der API nicht (passend) anbietet.
const storeImplementsRpc = (s: WikiStore): Omit<WikiRpc, FileOps> => s
void storeImplementsRpc

/** Ohne Anmeldung erlaubt: Datei wählen, Anmelden, Updates. */
const PUBLIC = new Set<string>([
  'getDbInfo',
  'newDb',
  'openDb',
  'openSampleDb',
  'revealDb',
  'confirmClose',
  'getLoginInfo',
  'login',
  'logout',
  'getUserName',
  'getUpdateState',
  'checkForUpdates',
  'downloadUpdate',
  'installUpdate',
  'openReleasePage'
])

/** Mindestrolle je Aktion; alles andere dürfen alle angemeldeten Benutzer (Mitarbeiter). */
const REQUIRED_ROLE: Partial<Record<keyof WikiRpc, Role>> = {
  approve: 'editor',
  reject: 'editor',
  purgeArticle: 'editor',
  emptyTrash: 'editor',
  setApprovalRequired: 'admin',
  listUsers: 'admin',
  createUser: 'admin',
  setUserRole: 'admin',
  resetPassword: 'admin',
  deleteUser: 'admin'
}
const RANK: Record<Role, number> = { author: 1, editor: 2, admin: 3 }

/** Prüft Anmeldung und Rolle; die Rolle wird jedes Mal frisch gelesen (ein Admin kann sie inzwischen geändert haben). */
function authorize(name: keyof WikiRpc): void {
  if (PUBLIC.has(name)) return
  const session = currentSession()
  if (!session) throw new WikiError('Bitte zuerst anmelden.')
  const user = currentStore()
    .listUsers()
    .find((u) => u.username.toLowerCase() === session.username.toLowerCase())
  if (!user || user.deleted) {
    setSession(null)
    throw new WikiError('Dein Benutzer wurde gelöscht oder gesperrt. Bitte neu anmelden.')
  }
  if (user.role !== session.role) setSession({ username: user.username, role: user.role })
  const need = REQUIRED_ROLE[name]
  if (need && RANK[user.role] < RANK[need]) throw new WikiError('Dafür fehlt dir die Berechtigung.')
}

const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const DB_FILTERS = [{ name: 'MindWiki-Datenbank', extensions: ['db'] }]

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')
}

function showError(win: BrowserWindow | null, message: string): void {
  const options = { type: 'error' as const, title: 'MindWiki', message }
  if (win) void dialog.showMessageBox(win, options)
  else void dialog.showMessageBox(options)
}

export function tryOpen(win: BrowserWindow | null, file: string): boolean {
  try {
    openWiki(file)
    return true
  } catch (err) {
    const reason = err instanceof NotAWikiError ? err.message : `Die Datei konnte nicht geöffnet werden.\n\n${String(err)}`
    showError(win, reason)
    return false
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null, allowClose: () => void): void {
  const fileOps: Pick<WikiRpc, FileOps> = {
    getDbInfo: () => ({ path: currentDbFile(), name: wikiName(), isSample: currentStore().isSample() }),

    getUpdateState,
    checkForUpdates: () => checkForUpdates(false),
    downloadUpdate,
    installUpdate,
    openReleasePage,

    openSampleDb: async () => {
      const win = getWindow()
      let file: string
      try {
        file = ensureSampleWiki(sampleDbPath())
      } catch (err) {
        showError(win, `Das Beispiel-Wiki konnte nicht angelegt werden.\n\n${String(err)}`)
        return false
      }
      if (path.resolve(file) === path.resolve(currentDbFile())) return false
      return tryOpen(win, file)
    },

    newDb: async () => {
      const win = getWindow()
      const options = {
        title: 'Neues Wiki anlegen',
        defaultPath: path.join(path.dirname(defaultDbPath()), 'Neues Wiki.db'),
        filters: DB_FILTERS
      }
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return false
      if (fs.existsSync(result.filePath)) {
        const answer = await dialog.showMessageBox({
          type: 'question',
          title: 'MindWiki',
          message: 'Diese Datei gibt es schon. Möchtest du sie öffnen?',
          buttons: ['Öffnen', 'Abbrechen'],
          defaultId: 0,
          cancelId: 1
        })
        if (answer.response !== 0) return false
      }
      return tryOpen(win, result.filePath)
    },

    openDb: async () => {
      const win = getWindow()
      const options = {
        title: 'Wiki öffnen',
        defaultPath: path.dirname(currentDbFile() || defaultDbPath()),
        filters: DB_FILTERS,
        properties: ['openFile' as const]
      }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      const file = result.filePaths[0]
      if (result.canceled || !file || file === currentDbFile()) return false
      return tryOpen(win, file)
    },

    backupDb: async () => {
      const win = getWindow()
      const options = {
        title: 'Sicherung speichern',
        // „manuell“ im Namen, damit die automatische Rotation sie nie löscht
        defaultPath: path.join(path.dirname(currentDbFile()), 'Sicherungen', `${wikiName()}_manuell_${stamp()}.db`),
        filters: DB_FILTERS
      }
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      if (path.resolve(result.filePath) === path.resolve(currentDbFile())) {
        showError(win, 'Die Sicherung darf nicht die geöffnete Datei überschreiben.')
        return null
      }
      backupTo(currentStore().db, result.filePath)
      return result.filePath
    },

    revealDb: () => shell.showItemInFolder(currentDbFile()),

    getUserName: () => currentSession()?.username ?? '',

    getLoginInfo: () => {
      const store = currentStore()
      return {
        session: currentSession(),
        defaultAdminPassword: store.adminHasDefaultPassword(),
        onlyAdmin: store.onlyAdmin(),
        isSample: store.isSample(),
        lastUser: loadSettings().lastUser ?? null
      }
    },

    login: async (username: string, password: string) => {
      const user = currentStore().verifyLogin(username, password)
      if (!user) {
        // kurze Pause erschwert das Durchprobieren von Passwörtern
        await new Promise((resolve) => setTimeout(resolve, 600))
        throw new WikiError('Benutzername oder Passwort stimmt nicht.')
      }
      const session = { username: user.username, role: user.role }
      setSession(session)
      saveSettings({ lastUser: user.username })
      return session
    },

    logout: () => setSession(null),

    changePassword: (oldPassword: string, newPassword: string) => {
      const session = currentSession()
      if (!session) throw new WikiError('Bitte zuerst anmelden.')
      currentStore().changeOwnPassword(session.username, oldPassword, newPassword)
    },

    confirmClose: allowClose
  }

  for (const name of RPC_METHODS) {
    ipcMain.handle(`wiki:${name}`, (_event, ...args: unknown[]) => {
      authorize(name)
      if (name in fileOps) {
        return (fileOps[name as FileOps] as (...a: unknown[]) => unknown)(...args)
      }
      if (name === 'saveImage' && (args[1] as Uint8Array).byteLength > MAX_IMAGE_BYTES) {
        throw new Error('Das Bild ist größer als 25 MB.')
      }
      const store = currentStore() as unknown as Record<string, (...a: unknown[]) => unknown>
      return store[name](...args)
    })
  }
}
