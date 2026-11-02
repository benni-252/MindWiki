import { app, BrowserWindow, dialog, Menu, nativeTheme, protocol, shell, type MenuItemConstructorOptions } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IMAGE_SCHEME, type MenuAction, type WikiEvent } from '../shared/types'
import { registerIpc, tryOpen } from './ipc'
import { ensureSampleWiki } from './sample'
import { defaultDbPath, loadSettings, sampleDbPath } from './settings'
import { closeWiki, currentStore, onWikiChange, peekStore, wikiName } from './wiki'

// Für automatische Tests: eigene Einstellungen und Datenbank statt der echten.
if (process.env.MINDWIKI_USER_DATA) app.setPath('userData', process.env.MINDWIKI_USER_DATA)

protocol.registerSchemesAsPrivileged([
  { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

let win: BrowserWindow | null = null
let closeAllowed = false

function send(event: WikiEvent): void {
  win?.webContents.send('wiki:event', event)
}

function menuAction(action: MenuAction): void {
  send({ type: 'menu', action })
}

function updateTitle(): void {
  win?.setTitle(`${wikiName()} – MindWiki`)
}

function buildMenu(): void {
  const item = (label: string, action: MenuAction, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => menuAction(action)
  })
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Datei',
      submenu: [
        item('Neues Wiki…', 'new-db', 'CmdOrCtrl+N'),
        item('Wiki öffnen…', 'open-db', 'CmdOrCtrl+O'),
        { type: 'separator' },
        item('Sicherung erstellen…', 'backup-db', 'CmdOrCtrl+Shift+S'),
        item('Speicherort im Explorer zeigen', 'reveal-db'),
        { type: 'separator' },
        item('Mein Name im Verlauf…', 'user-name'),
        item('Freigaben…', 'approvals'),
        { type: 'separator' },
        { role: 'quit', label: 'Beenden' }
      ]
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Rückgängig' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einfügen' },
        { role: 'selectAll', label: 'Alles auswählen' },
        { type: 'separator' },
        item('Suchen…', 'search', 'CmdOrCtrl+K'),
        item('Letzte Änderungen…', 'changes', 'CmdOrCtrl+Shift+H'),
        item('Papierkorb', 'trash')
      ]
    },
    {
      label: 'Ansicht',
      submenu: [
        item('Ganze Mind Map zeigen', 'fit', 'CmdOrCtrl+0'),
        item('Querverweise ein/aus', 'toggle-links', 'CmdOrCtrl+L'),
        item('Störungen und Auswirkungen…', 'outages'),
        { type: 'separator' },
        { role: 'zoomIn', label: 'Schrift größer', accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut', label: 'Schrift kleiner' },
        { role: 'resetZoom', label: 'Schriftgröße zurücksetzen', accelerator: 'CmdOrCtrl+Shift+0' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const, label: 'Entwicklerwerkzeuge' }])
      ]
    },
    {
      label: 'Hilfe',
      submenu: [
        item('Tastaturkürzel', 'shortcuts', 'F1'),
        item('Beispiel-Wiki öffnen', 'sample-db'),
        { type: 'separator' },
        item('Über MindWiki', 'about')
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Andere Rechner können dieselbe Datei ändern: regelmäßig nachsehen und die Oberfläche neu laden lassen.
const WATCH_INTERVAL_MS = 2000
let seenDataVersion: number | null = null

function watchForeignChanges(): void {
  setInterval(() => {
    const store = peekStore()
    if (!store || !win) return
    try {
      const version = store.dataVersion()
      if (seenDataVersion !== null && version !== seenDataVersion) send({ type: 'external-change' })
      seenDataVersion = version
    } catch {
      // Datei kurz nicht erreichbar (Netzlaufwerk) – beim nächsten Mal erneut versuchen
    }
  }, WATCH_INTERVAL_MS)
}

function createWindow(): void {
  closeAllowed = false
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    show: false,
    title: `${wikiName()} – MindWiki`,
    // Im fertigen Programm kommt das Symbol aus der .exe
    icon: app.isPackaged ? undefined : path.join(app.getAppPath(), 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win?.show())
  // Der Fenstertitel zeigt den Wiki-Namen, nicht den <title> der Seite.
  win.on('page-title-updated', (event) => event.preventDefault())

  // Externe Links im Standardbrowser öffnen, innerhalb der App nie wegnavigieren.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win?.webContents.getURL()) event.preventDefault()
  })

  // Vor dem Schließen speichert die Oberfläche noch offene Änderungen.
  win.on('close', (event) => {
    if (closeAllowed) return
    event.preventDefault()
    send({ type: 'request-close' })
    setTimeout(() => {
      closeAllowed = true
      win?.close()
    }, 3000)
  })
  win.on('closed', () => {
    win = null
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function openInitialWiki(): boolean {
  const override = process.env.MINDWIKI_DB
  if (override) return tryOpen(null, override)
  // Eine zuletzt benutzte, inzwischen gelöschte Datei wird nicht still neu angelegt.
  const last = loadSettings().lastDbPath
  if (last && fs.existsSync(last) && tryOpen(null, last)) return true
  // Allererster Start: Statt eines leeren Wikis das Beispiel zeigen, damit man sieht, wie es aussieht.
  if (!last && !fs.existsSync(defaultDbPath())) {
    try {
      if (tryOpen(null, ensureSampleWiki(sampleDbPath()))) return true
    } catch (err) {
      console.error('Beispiel-Wiki konnte nicht angelegt werden', err)
    }
  }
  return tryOpen(null, defaultDbPath())
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(() => {
    protocol.handle(IMAGE_SCHEME, (request) => {
      const id = Number(new URL(request.url).pathname.replace(/^\/+/, ''))
      const image = Number.isInteger(id) ? currentStore().getImage(id) : undefined
      if (!image) return new Response('Bild nicht gefunden', { status: 404 })
      return new Response(Buffer.from(image.data), {
        headers: { 'content-type': image.mime, 'cache-control': 'no-store' }
      })
    })

    registerIpc(
      () => win,
      () => {
        closeAllowed = true
        win?.close()
      }
    )
    onWikiChange(() => {
      seenDataVersion = null
      updateTitle()
    })

    if (!openInitialWiki()) {
      dialog.showErrorBox('MindWiki', 'Es konnte keine Wiki-Datenbank geöffnet oder angelegt werden.')
      app.quit()
      return
    }
    buildMenu()
    createWindow()
    watchForeignChanges()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    closeWiki()
    app.quit()
  })
}
