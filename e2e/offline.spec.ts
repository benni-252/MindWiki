import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { addChild, launch, makeWorkDir, node, removeDir, shots } from './app'

// Die Wiki-Datei wird während des Tests wirklich gesperrt – so, als hinge das Netzlaufwerk.
const workDir = makeWorkDir()
const dbFile = path.join(workDir, 'Team.db')
const ENV = { MINDWIKI_BUSY_TIMEOUT_MS: '200' }
let running: ElectronApplication | null = null
let lock: DatabaseSync | null = null

function lockDb(): void {
  lock = new DatabaseSync(dbFile)
  lock.exec('BEGIN EXCLUSIVE')
}

function unlockDb(): void {
  lock?.exec('ROLLBACK')
  lock?.close()
  lock = null
}

test.setTimeout(120_000)
test.afterAll(async () => {
  unlockDb()
  await running?.close().catch(() => undefined)
  removeDir(workDir)
})

const status = (page: Page) => page.locator('.save-status')
const editor = (page: Page) => page.locator('.editor-content .ProseMirror')
const toast = (page: Page, text: string | RegExp) => page.locator('.toast', { hasText: text })

async function typeAtEnd(page: Page, text: string): Promise<void> {
  await editor(page).click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(text)
}

test('Nichts geht verloren, wenn die Wiki-Datei nicht erreichbar ist', async () => {
  let { app, page } = await launch(workDir, 'Team.db', ENV)
  running = app
  await addChild(page, 'Team', 'Firewall')
  await node(page, 'Firewall').click()
  await typeAtEnd(page, 'Erster Satz.')
  await expect(status(page)).toHaveText('Gespeichert', { timeout: 5000 })

  // Speichern von Hand: Knopf und Strg+S
  await page.locator('.panel').getByRole('button', { name: 'Speichern' }).click()
  await expect(toast(page, 'Gespeichert.')).toBeVisible()
  await page.keyboard.press('Control+s')
  await expect(toast(page, 'Gespeichert.').first()).toBeVisible()

  // 1. Datei kurz nicht erreichbar: Text bleibt, MindWiki speichert von selbst, sobald es wieder geht
  lockDb()
  await typeAtEnd(page, ' Zweiter Satz.')
  await expect(status(page)).toHaveText('Nicht gespeichert', { timeout: 10_000 })
  await expect(toast(page, 'Speichern nicht möglich')).toContainText('gesperrt oder nicht erreichbar')
  await expect(toast(page, 'Speichern nicht möglich')).toContainText('auf diesem Rechner aufgehoben')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'offline-01-nicht-gespeichert.png') })
  unlockDb()
  await expect(status(page)).toHaveText('Gespeichert', { timeout: 10_000 })
  await expect(toast(page, 'wieder erreichbar')).toBeVisible()

  // 2. Artikel schließen, während nicht gespeichert werden kann: Nachfrage
  lockDb()
  await typeAtEnd(page, ' Dritter Satz.')
  await expect(status(page)).toHaveText('Nicht gespeichert', { timeout: 10_000 })
  await page.locator('.panel').getByTitle(/^Schließen/).click()
  const ask = page.getByRole('dialog', { name: 'Text nicht gespeichert' })
  await expect(ask).toContainText('auf diesem Rechner aufgehoben')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'offline-02-nachfrage.png') })
  await ask.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(page.locator('.panel')).toBeVisible()
  await expect(editor(page)).toContainText('Dritter Satz.')

  // Auch ein Klick auf einen anderen Artikel fragt nach
  await node(page, 'Team').click()
  await expect(ask).toBeVisible()
  await ask.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(page.locator('.panel .article-title')).toHaveValue('Firewall')

  // 3. MindWiki beenden: Nachfrage, die nicht nach 3 Sekunden von selbst verschwindet
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  const quit = page.getByRole('dialog', { name: 'MindWiki trotzdem beenden?' })
  await expect(quit).toContainText('beim nächsten Start wiederherstellen')
  await page.waitForTimeout(3500)
  await expect(quit).toBeVisible()
  await quit.getByRole('button', { name: 'Abbrechen' }).click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  const closed = app.waitForEvent('close')
  // Das Fenster geht beim Klick sofort zu – Playwright meldet den Klick dann als abgebrochen
  await quit
    .getByRole('button', { name: 'Trotzdem beenden' })
    .click()
    .catch(() => undefined)
  await closed
  unlockDb()

  // 4. Nächster Start: Hinweis auf den aufgehobenen Text, Wiederherstellen speichert ihn
  ;({ app, page } = await launch(workDir, 'Team.db', ENV))
  running = app
  const bar = page.locator('.notice-bar', { hasText: 'Nicht gespeicherter Text' })
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: 'Firewall öffnen' }).click()
  const banner = page.locator('.unsaved-banner')
  await expect(banner).toContainText('Nicht gespeicherter Text vom')
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false')
  await expect(editor(page)).not.toContainText('Dritter Satz.')
  await expect(bar).toHaveCount(0)
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'offline-03-wiederherstellen.png') })
  await banner.getByRole('button', { name: 'Wiederherstellen' }).click()
  await expect(toast(page, 'Text wiederhergestellt und gespeichert.')).toBeVisible()
  await expect(banner).toHaveCount(0)
  await expect(editor(page)).toContainText('Erster Satz. Zweiter Satz. Dritter Satz.')
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true')

  // 5. „Trotzdem schließen“ und später verwerfen
  lockDb()
  await typeAtEnd(page, ' Vierter Satz.')
  await expect(status(page)).toHaveText('Nicht gespeichert', { timeout: 10_000 })
  await page.locator('.panel').getByTitle(/^Schließen/).click()
  await page.getByRole('dialog', { name: 'Text nicht gespeichert' }).getByRole('button', { name: 'Trotzdem schließen' }).click()
  await expect(page.locator('.panel')).toHaveCount(0)
  await expect(bar).toBeVisible()
  unlockDb()
  await bar.getByRole('button', { name: 'Firewall öffnen' }).click()
  await banner.getByRole('button', { name: 'Verwerfen' }).click()
  await page.getByRole('dialog', { name: 'Aufgehobenen Text verwerfen?' }).getByRole('button', { name: 'Verwerfen' }).click()
  await expect(banner).toHaveCount(0)
  await expect(editor(page)).toContainText('Dritter Satz.')
  await expect(editor(page)).not.toContainText('Vierter Satz.')
  await expect(bar).toHaveCount(0)
  await app.close()
})
