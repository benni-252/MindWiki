import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { launch, makeWorkDir, removeDir, shots } from './app'

// Ein kleiner Firmen-Proxy, der Benutzername und Passwort verlangt (wie bei Basic-Anmeldung üblich).
const USER = 'FIRMA\\benjamin'
const PASSWORD = 'Sommer-2026'
const UPDATE_URL = 'http://updates.mindwiki.test/latest'

const workDir = makeWorkDir()
const seen: string[] = []
let running: ElectronApplication | null = null
let port = 0

const proxy = http.createServer((req, res) => {
  const auth = req.headers['proxy-authorization']
  if (auth !== `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`) {
    seen.push(auth ? 'abgelehnt' : 'ohne Anmeldung')
    res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="Firmen-Proxy"', 'Content-Type': 'text/plain' })
    res.end('Proxy Authentication Required')
    return
  }
  seen.push('angemeldet')
  if (req.url === UPDATE_URL) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ tag_name: 'v999.0.0' }))
  } else {
    res.writeHead(404)
    res.end()
  }
})

test.beforeAll(async () => {
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  port = (proxy.address() as AddressInfo).port
})

test.afterAll(async () => {
  await running?.close().catch(() => undefined)
  await new Promise((resolve) => proxy.close(resolve))
  removeDir(workDir)
})

/** Startet MindWiki hinter dem Test-Proxy (wie die portable Version, Versionsabfrage an UPDATE_URL). */
async function start(): Promise<{ app: ElectronApplication; page: Page }> {
  const started = await launch(workDir, 'Proxy.db', { MINDWIKI_UPDATE_URL: UPDATE_URL })
  running = started.app
  await started.app.evaluate(async ({ safeStorage, session }, p) => {
    await session.defaultSession.setProxy({ proxyRules: `http=127.0.0.1:${p}` })
    // Linux-Testrechner ohne Passwortspeicher: Ersatz-Verschlüsselung (unter Windows: Windows-Konto)
    if (process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true)
  }, port)
  return started
}

async function checkForUpdates(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('wiki:event', { type: 'menu', action: 'check-updates' })
  )
}

test('Anmeldung am Firmen-Proxy für die Update-Prüfung', async () => {
  let { app, page } = await start()
  expect(await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable())).toBe(true)
  // Dialoge immer im aktuellen Fenster suchen (die App wird mehrmals neu gestartet)
  let updates = page.getByRole('dialog', { name: 'Updates' })
  let login = page.getByRole('dialog', { name: 'Anmeldung am Proxy-Server' })
  const restart = async (): Promise<void> => {
    ;({ app, page } = await start())
    updates = page.getByRole('dialog', { name: 'Updates' })
    login = page.getByRole('dialog', { name: 'Anmeldung am Proxy-Server' })
  }

  // Der Proxy verlangt eine Anmeldung: MindWiki fragt nach, statt hängen zu bleiben
  await checkForUpdates(app)
  await expect(updates).toContainText('Suche nach einer neuen Version')
  await expect(login).toContainText(`Der Proxy-Server 127.0.0.1:${port} verlangt dafür eine Anmeldung.`)
  await expect(login).toContainText('Bereich: „Firmen-Proxy“')
  await login.getByLabel('Benutzername').fill(USER)
  await login.getByLabel('Passwort').fill('falsch')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'proxy-01-anmeldung.png') })
  await login.getByRole('button', { name: 'Anmelden' }).click()

  // Falsches Passwort: erneut fragen, Benutzername bleibt stehen
  await expect(login.getByRole('alert')).toHaveText(/nicht angenommen/)
  await expect(login.getByLabel('Benutzername')).toHaveValue(USER)
  await expect(login.getByLabel('Passwort')).toHaveValue('')
  await expect(login.getByLabel('Passwort')).toBeFocused()

  // Richtiges Passwort (mit Enter): Die Prüfung läuft durch
  await page.keyboard.type(PASSWORD)
  await page.keyboard.press('Enter')
  await expect(login).toHaveCount(0)
  await expect(updates).toContainText('Version 999.0.0 ist verfügbar')
  expect(seen).toEqual(['ohne Anmeldung', 'abgelehnt', 'angemeldet'])
  await expect(updates).toContainText(`Anmeldung für den Proxy 127.0.0.1:${port} ist gespeichert.`)
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'proxy-02-update.png') })
  await updates.locator('footer').getByRole('button', { name: 'Schließen' }).click()
  await app.close()

  // Nächster Start: Die gemerkte Anmeldung wird ohne Nachfrage benutzt
  await restart()
  await checkForUpdates(app)
  await expect(updates).toContainText('Version 999.0.0 ist verfügbar')
  await expect(login).toHaveCount(0)
  // … und lässt sich im Update-Dialog löschen
  await updates.getByRole('button', { name: 'Löschen' }).click()
  await expect(page.locator('.toast', { hasText: 'Gespeicherte Proxy-Anmeldung gelöscht.' })).toBeVisible()
  await expect(updates).not.toContainText('ist gespeichert')
  await app.close()

  // Ohne gemerkte Anmeldung: Abbrechen beendet die Prüfung mit einer verständlichen Meldung
  await restart()
  await checkForUpdates(app)
  await expect(login).toBeVisible()
  await expect(login.getByRole('checkbox')).toBeChecked()
  // Escape schließt nur die Abfrage, der Update-Dialog bleibt offen
  await page.keyboard.press('Escape')
  await expect(login).toHaveCount(0)
  await expect(updates).toContainText('Der Proxy-Server hat keine Anmeldung bekommen.')
  await expect(updates.getByRole('button', { name: 'Download-Seite öffnen' })).toBeVisible()
  await expect(page.locator('.toast.error')).toHaveCount(0)
  await app.close()
})
