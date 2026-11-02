import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { RPC_METHODS, type WikiRpc } from '../shared/types'
import { backupTo, NotAWikiError } from './db'
import { ensureSampleWiki } from './sample'
import { defaultDbPath, sampleDbPath, saveSettings, userName } from './settings'
import type { WikiStore } from './store'
import { currentDbFile, currentStore, openWiki, wikiName } from './wiki'

type FileOps =
  | 'getDbInfo'
  | 'openSampleDb'
  | 'newDb'
  | 'openDb'
  | 'backupDb'
  | 'revealDb'
  | 'confirmClose'
  | 'getUserName'
  | 'setUserName'

// Bricht die Typprüfung, wenn WikiStore eine Datenmethode der API nicht (passend) anbietet.
const storeImplementsRpc = (s: WikiStore): Omit<WikiRpc, FileOps> => s
void storeImplementsRpc

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

    getUserName: () => userName(),

    setUserName: (name: string) => {
      saveSettings({ userName: name.trim().slice(0, 60) || undefined })
      currentStore().author = userName()
      return userName()
    },

    confirmClose: allowClose
  }

  for (const name of RPC_METHODS) {
    ipcMain.handle(`wiki:${name}`, (_event, ...args: unknown[]) => {
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
