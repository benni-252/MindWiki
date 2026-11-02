import { expect, test, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launch, login, makeWorkDir, node, removeDir, shots } from './app'

const workDir = makeWorkDir()
const documents = path.join(workDir, 'Dokumente')
let running: ElectronApplication | null = null

test.afterAll(async () => {
  await running?.close().catch(() => undefined)
  removeDir(workDir)
})

test('Beispiel-Wiki beim ersten Start und über das Hilfe-Menü', async () => {
  // Frische Installation: noch kein eigenes Wiki → das Beispiel erscheint
  let { app, page } = await launch(workDir, null, { MINDWIKI_DOCUMENTS: documents }, null)
  running = app
  await expect(page.locator('.login-hint')).toContainText('Beispiel-Zugänge')
  await page.screenshot({ path: path.join(shots, 'anmeldung-beispiel.png') })
  await login(page, { username: 'Anna', password: 'demo' })
  await expect(page.locator('.user-chip')).toContainText('Anna')
  await expect(page.locator('.notice-bar')).toContainText('Beispiel-Wiki')
  await expect(node(page, 'SRV-SQL01')).toHaveClass(/\boutage\b/)
  await expect(node(page, 'Warenwirtschaft')).toHaveClass(/\baffected\b/)
  await expect(node(page, 'Dienstleister').locator('.mm-toggle.collapsed')).toHaveText('+1')
  await expect(page.locator('.outage-pill')).toHaveText(/1 Störung\s*· 2 betroffen/)
  expect(fs.existsSync(path.join(documents, 'MindWiki', 'Beispiel-Wiki.db'))).toBe(true)
  expect(fs.existsSync(path.join(documents, 'MindWiki', 'Wiki.db'))).toBe(false)
  await page.keyboard.press('Control+0')
  await page.waitForTimeout(700)
  await page.screenshot({ path: path.join(shots, 'beispiel-01-mindmap.png') })

  // Ein Artikel mit Steckbrief, Text, Ablauf-Protokoll und Verlauf
  await node(page, 'SRV-DC01').click()
  await expect(page.locator('.panel .article-title')).toHaveValue('SRV-DC01')
  await expect(page.locator('.fs-value input[aria-label="Wert für IP-Adresse"]')).toHaveValue('10.0.10.10')
  await expect(page.locator('.editor-content h2', { hasText: 'Bekannte Probleme' })).toBeVisible()
  await expect(page.locator('.history-list li').first()).toContainText('Ben')
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(shots, 'beispiel-02-artikel.png') })

  // Gestörter Artikel mit Auswirkungen
  await node(page, 'SRV-SQL01').click()
  await expect(page.locator('.status-box.outage .impact-group h4')).toHaveText(['Direkt betroffen (1)', 'Indirekt betroffen (1)'])
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(shots, 'beispiel-03-stoerung.png') })
  await app.close()

  // Mit eigenem Wiki: kein Hinweis, Beispiel über Hilfe › Beispiel-Wiki öffnen
  ;({ app, page } = await launch(workDir, 'Eigenes.db', { MINDWIKI_DOCUMENTS: documents }))
  running = app
  await expect(node(page, 'Eigenes')).toBeVisible()
  await expect(page.locator('.notice-bar', { hasText: 'Beispiel-Wiki' })).toHaveCount(0)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('wiki:event', { type: 'menu', action: 'sample-db' })
  )
  // Andere Datei → neu anmelden
  await login(page, { username: 'Ben', password: 'demo' })
  await expect(page.locator('.notice-bar', { hasText: 'Beispiel-Wiki' })).toBeVisible()
  await expect(node(page, 'SRV-SQL01')).toBeVisible()
  await expect(page.locator('.toast.error')).toHaveCount(0)
  await app.close()
})
