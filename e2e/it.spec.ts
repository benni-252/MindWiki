import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import { addChild, launch as launchApp, makeWorkDir, node, removeDir, rename, shots } from './app'

const workDir = makeWorkDir()
let running: ElectronApplication | null = null

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const started = await launchApp(workDir, 'IT.db')
  running = started.app
  return started
}

test.afterAll(async () => {
  await running?.close().catch(() => undefined)
  removeDir(workDir)
})

test('Vorlagen, Steckbrief und Symbole', async () => {
  let { app, page } = await launch()

  // Unterartikel aus Vorlage über das Kontextmenü
  await node(page, 'IT').click({ button: 'right' })
  await page.getByRole('button', { name: 'Unterartikel aus Vorlage' }).click()
  await page.getByRole('menuitem', { name: /Server \/ System/ }).click()
  await rename(page, 'SRV-DC01')
  await expect(node(page, 'SRV-DC01').locator('svg.mm-icon[aria-label="Server"]')).toBeVisible()

  // Steckbrief, Gliederung und Ablauf aus der Vorlage
  await node(page, 'SRV-DC01').click()
  await expect(page.locator('.panel .article-title')).toHaveValue('SRV-DC01')
  await expect(page.locator('.factsheet input.fs-label').first()).toHaveValue('Hostname')
  await expect(page.locator('.editor-content h2', { hasText: 'Konfiguration' })).toBeVisible()
  await expect(page.locator('.checklist-title')).toHaveValue('Wartung / Neustart')
  await expect(page.locator('.step')).toHaveCount(6)
  await expect(page.locator('.template-chooser')).toHaveCount(0)

  const ip = page.locator('.fs-value input[aria-label="Wert für IP-Adresse"]')
  await ip.fill('10.0.0.10')
  await ip.press('Enter')
  const host = page.locator('.fs-value input[aria-label="Wert für Hostname"]')
  await host.fill('srv-dc01.firma.local')
  await host.press('Enter')

  // Eigenes Feld; bei „Passwort“ erscheint ein Hinweis
  await page.locator('.fs-head').getByRole('button', { name: 'Feld' }).click()
  const label = page.locator('.factsheet input.fs-label').last()
  await expect(label).toBeFocused()
  await label.fill('Passwort')
  await label.press('Enter')
  await page.locator('.fs-value input[aria-label="Wert für Passwort"]').fill('geheim')
  await expect(page.locator('.fs-warning')).toBeVisible()
  await page.locator('.fs-value input[aria-label="Wert für Passwort"]').press('Enter')
  await page.locator('.fs-value input[aria-label="Wert für Passwort"]').locator('xpath=..').getByTitle('Feld löschen').click()
  await expect(page.locator('.fs-warning')).toHaveCount(0)
  await page.screenshot({ path: path.join(shots, 'it-01-server.png') })

  // Lesemodus zeigt nur ausgefüllte Felder
  await page.getByTitle(/^Lesemodus/).click()
  await expect(page.locator('.factsheet.read .fs-label')).toHaveCount(2)
  await expect(page.locator('.factsheet.read .mono', { hasText: '10.0.0.10' })).toBeVisible()
  await page.getByTitle('Bearbeiten einschalten').click()

  // Suche findet Steckbrief-Werte
  await page.keyboard.press('Control+K')
  await page.locator('.search-input input').fill('10.0.0.10')
  await expect(page.locator('.search-hit')).toHaveCount(1)
  await expect(page.locator('.hit-snippet')).toContainText('IP-Adresse: 10.0.0.10')
  await page.keyboard.press('Escape')

  // Leerer Artikel: Vorlage nachträglich anwenden
  await addChild(page, 'IT', 'Core-Switch')
  await node(page, 'Core-Switch').click()
  await expect(page.locator('.template-chooser')).toBeVisible()
  await page.locator('.template-chooser').getByRole('button', { name: 'Netzwerkgerät' }).click()
  await expect(page.locator('.template-chooser')).toHaveCount(0)
  await expect(page.locator('.fs-value input[aria-label="Wert für Firmware"]')).toBeVisible()
  await expect(page.locator('.checklist-title')).toHaveValue('Firmware-Update')
  await expect(page.locator('.editor-content h2', { hasText: 'Ports / Verkabelung' })).toBeVisible()
  await expect(node(page, 'Core-Switch').locator('svg.mm-icon[aria-label="Netzwerk"]')).toBeVisible()

  // Symbol über das Kontextmenü ändern
  await node(page, 'Core-Switch').click({ button: 'right' })
  await page.getByRole('button', { name: 'Symbol wählen' }).click()
  await page.locator('.icon-grid').getByRole('button', { name: 'Router / Firewall' }).click()
  await expect(node(page, 'Core-Switch').locator('svg.mm-icon[aria-label="Router / Firewall"]')).toBeVisible()

  // Symbol im Artikel entfernen
  await page.getByTitle('Symbol ändern').click()
  await page.getByRole('button', { name: 'Kein Symbol' }).click()
  await expect(node(page, 'Core-Switch').locator('svg.mm-icon')).toHaveCount(0)

  // Plus-Knopf in der Kopfleiste mit Vorlage
  await node(page, 'IT').click()
  await page.getByTitle('Neuer Unterartikel zum ausgewählten Artikel').click()
  await page.getByRole('menuitem', { name: /Anleitung/ }).click()
  await rename(page, 'Drucker einrichten')
  await expect(node(page, 'Drucker einrichten').locator('svg.mm-icon[aria-label="Anleitung"]')).toBeVisible()

  // Nach Neustart ist alles gespeichert
  await app.close()
  ;({ app, page } = await launch())
  await expect(node(page, 'SRV-DC01').locator('svg.mm-icon[aria-label="Server"]')).toBeVisible()
  await node(page, 'SRV-DC01').click()
  await expect(page.locator('.fs-value input[aria-label="Wert für IP-Adresse"]')).toHaveValue('10.0.0.10')
  await expect(page.locator('.fs-value input[aria-label="Wert für Hostname"]')).toHaveValue('srv-dc01.firma.local')
  await expect(page.locator('.toast.error')).toHaveCount(0)
  await page.keyboard.press('Control+0')
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(shots, 'it-02-nach-neustart.png') })
  await app.close()
})
