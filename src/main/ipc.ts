import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { cleanAttachmentName, formatBytes, isBlockedAttachment, MAX_ATTACHMENT_BYTES } from '../shared/attachments'
import { RPC_METHODS, type Role, type WikiRpc } from '../shared/types'
import { backupTo, NotAWikiError } from './db'
import { friendlyDbError } from './dbErrors'
import { articleToHtml } from './exportHtml'
import { renderPdf } from './pdf'
import { ensureSampleWiki } from './sample'
import {
  answerProxyLogin,
  cancelProxyLogin,
  checkForUpdates,
  downloadUpdate,
  forgetProxyLogins,
  getProxyPrompt,
  getSavedProxyLogins,
  getUpdateState,
  installUpdate,
  openReleasePage
} from './updater'
import { defaultDbPath, loadSettings, sampleDbPath, saveSettings } from './settings'
import { WikiError, type WikiStore } from './store'
import { dbKey, UnsavedStore } from './unsaved'
import { currentDbFile, currentSession, currentStore, openWiki, setSession, wikiName } from './wiki'

type FileOps =
  | 'getDbInfo'
  | 'openSampleDb'
  | 'exportPdf'
  | 'addAttachmentFiles'
  | 'openAttachment'
  | 'saveAttachmentAs'
  | 'getUpdateState'
  | 'checkForUpdates'
  | 'downloadUpdate'
  | 'installUpdate'
  | 'openReleasePage'
  | 'answerProxyLogin'
  | 'cancelProxyLogin'
  | 'getProxyPrompt'
  | 'getSavedProxyLogins'
  | 'forgetProxyLogins'
  | 'keepUnsaved'
  | 'dropUnsaved'
  | 'listUnsaved'
  | 'holdClose'
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
  'openReleasePage',
  'answerProxyLogin',
  'cancelProxyLogin',
  'getProxyPrompt',
  'getSavedProxyLogins',
  'forgetProxyLogins',
  // Brauchen die Wiki-Datei nicht – müssen gerade dann gehen, wenn sie nicht erreichbar ist
  'keepUnsaved',
  'dropUnsaved',
  'listUnsaved',
  'holdClose'
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

/** Geöffnete Anhänge: schreibgeschützte Kopien im Temp-Ordner (je Öffnen ein eigener Ordner). */
const ATTACHMENT_TEMP = (): string => path.join(app.getPath('temp'), 'MindWiki-Anhaenge')

/** Alte geöffnete Kopien (älter als einen Tag) wegräumen – was noch offen ist, bleibt liegen. */
function cleanupOpenedAttachments(): void {
  const root = ATTACHMENT_TEMP()
  if (!fs.existsSync(root)) return
  const cutoff = Date.now() - 24 * 60 * 60_000
  for (const entry of fs.readdirSync(root)) {
    const dir = path.join(root, entry)
    try {
      if (fs.statSync(dir).mtimeMs > cutoff) continue
      for (const f of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, f), 0o644)
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // noch in Benutzung – beim nächsten Mal
    }
  }
}

/** Nicht gespeicherte Texte: im Benutzerordner dieses Rechners, je Wiki-Datei und Benutzer. */
function unsavedStore(): { store: UnsavedStore; db: string; user: string } {
  const session = currentSession()
  if (!session) throw new WikiError('Bitte zuerst anmelden.')
  return {
    store: new UnsavedStore(path.join(app.getPath('userData'), 'Nicht-gespeichert.json')),
    db: dbKey(currentDbFile()),
    user: session.username
  }
}

export function registerIpc(
  getWindow: () => BrowserWindow | null,
  allowClose: () => void,
  holdClose: () => void
): void {
  const fileOps: Pick<WikiRpc, FileOps> = {
    getDbInfo: () => ({ path: currentDbFile(), name: wikiName(), isSample: currentStore().isSample() }),

    exportPdf: async (id: number) => {
      const store = currentStore()
      const article = store.exportArticle(id)
      const win = getWindow()
      // Dateiname ohne Zeichen, die Windows nicht erlaubt
      const name = article.title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Artikel'
      const options = {
        title: 'Als PDF exportieren',
        defaultPath: path.join(app.getPath('documents'), `${name}.pdf`),
        filters: [{ name: 'PDF-Dokument', extensions: ['pdf'] }]
      }
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      const html = articleToHtml(article, {
        articleTitle: (linked) => store.liveTitle(linked),
        imageSrc: (src) => {
          const match = /wikiimg:\/\/img\/(\d+)/.exec(src)
          const image = match ? store.getImage(Number(match[1])) : undefined
          return image ? `data:${image.mime};base64,${Buffer.from(image.data).toString('base64')}` : undefined
        }
      })
      fs.writeFileSync(result.filePath, await renderPdf(html))
      return result.filePath
    },

    addAttachmentFiles: async (articleId) => {
      const win = getWindow()
      const options = {
        title: 'Datei anhängen',
        buttonLabel: 'Anhängen',
        properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>
      }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      const skipped: string[] = []
      let added = 0
      if (result.canceled) return { added, skipped }
      const store = currentStore()
      for (const file of result.filePaths) {
        const name = path.basename(file)
        try {
          // Größe vorher prüfen, damit riesige Dateien gar nicht erst gelesen werden
          const size = fs.statSync(file).size
          if (size > MAX_ATTACHMENT_BYTES) {
            skipped.push(`„${name}“ ist zu groß (${formatBytes(size)}) – höchstens ${formatBytes(MAX_ATTACHMENT_BYTES)} pro Datei.`)
            continue
          }
          store.addAttachment(articleId, name, fs.readFileSync(file))
          added++
        } catch (err) {
          const friendly = friendlyDbError(err)
          const message = friendly instanceof Error ? friendly.message : String(friendly)
          skipped.push(friendly instanceof WikiError ? message : `„${name}“ konnte nicht gelesen werden: ${message}`)
        }
      }
      return { added, skipped }
    },

    openAttachment: async (id) => {
      const file = currentStore().getAttachmentFile(id)
      if (!file) throw new WikiError('Diesen Anhang gibt es nicht mehr.')
      if (isBlockedAttachment(file.name)) {
        throw new WikiError('Aus Sicherheitsgründen öffnet MindWiki Programme und Skripte nicht.')
      }
      cleanupOpenedAttachments()
      const dir = path.join(ATTACHMENT_TEMP(), `${id}-${Date.now()}`)
      fs.mkdirSync(dir, { recursive: true })
      const target = path.join(dir, cleanAttachmentName(file.name))
      fs.writeFileSync(target, file.data)
      // Schreibgeschützt: Änderungen an der Kopie würden nicht ins Wiki zurückfließen
      fs.chmodSync(target, 0o444)
      const error = await shell.openPath(target)
      if (error) throw new WikiError(`Der Anhang konnte nicht geöffnet werden: ${error}`)
    },

    saveAttachmentAs: async (id) => {
      const file = currentStore().getAttachmentFile(id)
      if (!file) throw new WikiError('Diesen Anhang gibt es nicht mehr.')
      const win = getWindow()
      const options = {
        title: 'Anhang speichern',
        defaultPath: path.join(app.getPath('documents'), cleanAttachmentName(file.name))
      }
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      fs.writeFileSync(result.filePath, file.data)
      return result.filePath
    },

    getUpdateState,
    checkForUpdates: () => checkForUpdates(false),
    downloadUpdate,
    installUpdate,
    openReleasePage,
    answerProxyLogin,
    cancelProxyLogin,
    getProxyPrompt,
    getSavedProxyLogins,
    forgetProxyLogins,

    keepUnsaved: (text) => {
      const { store, db, user } = unsavedStore()
      store.keep(db, user, { ...text, at: new Date().toISOString() })
    },
    dropUnsaved: (contentId) => {
      const { store, db, user } = unsavedStore()
      store.drop(db, user, contentId)
    },
    listUnsaved: () => {
      const { store, db, user } = unsavedStore()
      return store.list(db, user)
    },
    holdClose,

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
      try {
        authorize(name)
        let result: unknown
        if (name in fileOps) {
          result = (fileOps[name as FileOps] as (...a: unknown[]) => unknown)(...args)
        } else {
          if (name === 'saveImage' && (args[1] as Uint8Array).byteLength > MAX_IMAGE_BYTES) {
            throw new Error('Das Bild ist größer als 25 MB.')
          }
          const store = currentStore() as unknown as Record<string, (...a: unknown[]) => unknown>
          result = store[name](...args)
        }
        // Fehler der Wiki-Datei (gesperrt, Netzlaufwerk weg …) verständlich melden
        return result instanceof Promise
          ? result.catch((err: unknown) => {
              throw friendlyDbError(err)
            })
          : result
      } catch (err) {
        throw friendlyDbError(err)
      }
    })
  }
}
