import { expect, test, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { openDatabase } from '../src/main/db'
import { WikiStore } from '../src/main/store'
import { launch, makeWorkDir, removeDir, shots } from './app'

const workDir = makeWorkDir()
let running: ElectronApplication | null = null

test.afterAll(async () => {
  await running?.close().catch(() => undefined)
  removeDir(workDir)
})

test('Suche in den letzten Änderungen', async () => {
  // Verlauf von mehreren Personen
  fs.mkdirSync(workDir, { recursive: true })
  const store = new WikiStore(openDatabase(path.join(workDir, 'Team.db'), 'Team'), 'Anna')
  const root = store.rootId()
  const fw = store.createArticle(root, 'Firewall')
  const sw = store.createArticle(root, 'Switch Etage 2')
  store.author = 'Björn'
  store.addField(fw, 'IP-Adresse', '10.0.0.1')
  store.addField(sw, 'Standort', 'Serverraum')
  store.author = 'Anna'
  store.updateField(store.getFields(fw)[0].id, 'IP-Adresse', '10.0.0.254')
  store.db.close()

  const { app, page } = await launch(workDir, 'Team.db')
  running = app
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('wiki:event', { type: 'menu', action: 'changes' })
  )
  const dialog = page.getByRole('dialog', { name: 'Letzte Änderungen' })
  const search = dialog.getByRole('searchbox', { name: 'Änderungen durchsuchen' })
  const titles = dialog.locator('.change-title')
  await expect(search).toBeFocused()
  await dialog.getByRole('tab', { name: 'Alle' }).click()
  await expect(titles).toHaveCount(5)

  // Nach Person (Groß-/Kleinschreibung und Umlaute egal)
  await search.fill('björn')
  await expect(dialog.locator('.changes-count')).toHaveText('2 Treffer')
  await expect(dialog.locator('.change-meta mark')).toHaveText(['Björn', 'Björn'])

  // Mehrere Wörter: Person und Wert aus dem Steckbrief
  await search.fill('anna 10.0.0')
  await expect(dialog.locator('.change-summary')).toHaveText(['IP-Adresse: „10.0.0.1“ → „10.0.0.254“'])
  await expect(dialog.locator('.change-summary mark')).toHaveText(['10.0.0', '10.0.0'])
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'aenderungen-suche.png') })

  // Nach Artikel; ein Klick öffnet ihn
  await search.fill('switch')
  await expect(titles).toHaveText(['Switch Etage 2', 'Switch Etage 2'])
  await search.fill('gibt es nicht')
  await expect(dialog).toContainText('Keine Änderungen gefunden für „gibt es nicht“.')

  // Escape leert erst die Suche, dann schließt es den Dialog
  await page.keyboard.press('Escape')
  await expect(search).toHaveValue('')
  await expect(titles).toHaveCount(5)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.toast.error')).toHaveCount(0)
  await app.close()
})
