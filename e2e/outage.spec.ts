import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import { addChild, launch as launchApp, makeWorkDir, node, removeDir, shots } from './app'

const workDir = makeWorkDir()
let running: ElectronApplication | null = null

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const started = await launchApp(workDir, 'Betrieb.db')
  running = started.app
  return started
}

test.afterAll(async () => {
  await running?.close().catch(() => undefined)
  removeDir(workDir)
})

/** Öffnet `article` und trägt über die Auswahlliste eine Abhängigkeit ein. */
async function addDependency(page: Page, article: string, button: RegExp | string, other: string): Promise<void> {
  await node(page, article).click()
  await expect(page.locator('.panel .article-title')).toHaveValue(article)
  await page.locator('.panel').getByRole('button', { name: button }).click()
  const picker = page.locator('.dep-picker input')
  await expect(picker).toBeFocused()
  await picker.fill(other.slice(0, 5))
  await expect(page.locator('.dep-suggestions button.active')).toContainText(other)
  await picker.press('Enter')
  await expect(page.locator('.deps .chip-main', { hasText: other })).toBeVisible()
}

test('Abhängigkeiten und Auswirkungen einer Störung', async () => {
  let { app, page } = await launch()

  for (const title of ['Core-Switch', 'SQL-Server', 'App-Server', 'Warenwirtschaft', 'Büro']) {
    await addChild(page, 'Betrieb', title)
  }
  await addChild(page, 'Büro', 'Drucker')

  // Abhängigkeiten in beide Richtungen eintragen
  await addDependency(page, 'SQL-Server', /Abhängigkeit \(wovon hängt/, 'Core-Switch')
  await addDependency(page, 'App-Server', /Abhängigkeit \(wovon hängt/, 'SQL-Server')
  await addDependency(page, 'Warenwirtschaft', /Abhängigkeit \(wovon hängt/, 'App-Server')
  await addDependency(page, 'Core-Switch', 'Abhängigen Artikel hinzufügen', 'Drucker')
  await expect(page.locator('.dep-group', { hasText: 'Wird benötigt von' }).locator('.chip-main')).toHaveText([
    'Drucker',
    'SQL-Server'
  ])
  await expect(page.locator('.react-flow__edge.dep-edge')).toHaveCount(4)
  await expect(page.locator('.react-flow__edge.dep-edge.impact')).toHaveCount(0)

  // Störung am Core-Switch melden
  await node(page, 'Core-Switch').click({ button: 'right' })
  await page.locator('.menu').getByRole('button', { name: 'Störung melden' }).click()
  await expect(page.locator('.toast', { hasText: 'Störung gemeldet – 4 Artikel sind betroffen.' })).toBeVisible()
  await expect(node(page, 'Core-Switch')).toHaveClass(/\boutage\b/)
  for (const title of ['SQL-Server', 'App-Server', 'Warenwirtschaft', 'Drucker']) {
    await expect(node(page, title)).toHaveClass(/\baffected\b/)
  }
  await expect(node(page, 'Büro')).not.toHaveClass(/\baffected\b/)
  await expect(page.locator('.react-flow__edge.dep-edge.impact')).toHaveCount(4)
  await expect(page.locator('.outage-pill')).toHaveText(/1 Störung\s*· 4 betroffen/)

  // Der gestörte Artikel zeigt, was alles betroffen ist
  await node(page, 'Core-Switch').click()
  const box = page.locator('.status-box.outage')
  await expect(box).toBeVisible()
  const groups = box.locator('.impact-group')
  await expect(groups.locator('h4')).toHaveText(['Direkt betroffen (2)', 'Indirekt betroffen (2)'])
  await expect(groups.nth(0).locator('.chip-main')).toHaveText(['Drucker', 'SQL-Server'])
  await expect(groups.nth(1).locator('.chip-main')).toHaveText(['App-Server', 'Warenwirtschaft'])
  await box.getByLabel('Notiz zur Störung').fill('Netzteil defekt')
  await box.getByLabel('Notiz zur Störung').press('Enter')
  await page.screenshot({ path: path.join(shots, 'stoerung-01-switch.png') })

  // Ein betroffener Artikel zeigt den Weg der Störung
  await node(page, 'Warenwirtschaft').click()
  const affected = page.locator('.status-box.affected')
  await expect(affected).toBeVisible()
  await expect(affected.locator('.impact-chain')).toHaveText(/Core-Switch.*SQL-Server.*App-Server.*Warenwirtschaft/)
  await page.screenshot({ path: path.join(shots, 'stoerung-02-betroffen.png') })

  // Eingeklappte Äste verraten betroffene Unterartikel
  await node(page, 'Büro').click()
  await page.keyboard.press('Space')
  await expect(node(page, 'Drucker')).toHaveCount(0)
  await expect(node(page, 'Büro').locator('.mm-toggle.hides-affected')).toBeVisible()
  await page.keyboard.press('Space')
  await expect(node(page, 'Drucker')).toBeVisible()

  // Ohne Querverweise bleiben nur die Wege der Störung sichtbar
  await page.keyboard.press('Control+L')
  await expect(page.locator('.react-flow__edge.dep-edge')).toHaveCount(4)
  await page.keyboard.press('Control+L')

  // Nach dem Neustart ist die Störung noch da
  await app.close()
  ;({ app, page } = await launch())
  await expect(node(page, 'Core-Switch')).toHaveClass(/\boutage\b/)
  await expect(node(page, 'Warenwirtschaft')).toHaveClass(/\baffected\b/)
  await page.keyboard.press('Control+0')
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(shots, 'stoerung-03-mindmap.png') })

  // Übersicht über alle Störungen, dort auch beheben
  await page.locator('.outage-pill').click()
  const dialog = page.getByRole('dialog', { name: 'Störungen' })
  await expect(dialog.locator('.outage-row')).toContainText('Core-Switch')
  await expect(dialog.locator('.outage-row')).toContainText('Netzteil defekt')
  await expect(dialog.locator('.chip-main')).toHaveCount(4)
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'stoerung-04-uebersicht.png') })
  await dialog.getByRole('button', { name: 'Beheben' }).click()
  await expect(dialog).toContainText('Zurzeit ist keine Störung gemeldet.')
  await dialog.getByRole('button', { name: 'Fertig' }).click()
  await expect(page.locator('.outage-pill')).toHaveCount(0)
  await expect(page.locator('.mm-node.outage, .mm-node.affected')).toHaveCount(0)
  await expect(page.locator('.react-flow__edge.dep-edge.impact')).toHaveCount(0)

  // Abhängigkeit wieder entfernen
  await node(page, 'App-Server').click()
  await page.getByRole('button', { name: 'Abhängigkeit entfernen: SQL-Server' }).click()
  await expect(page.locator('.deps .chip-main', { hasText: 'SQL-Server' })).toHaveCount(0)
  await expect(page.locator('.react-flow__edge.dep-edge')).toHaveCount(3)
  await expect(page.locator('.toast.error')).toHaveCount(0)
  await app.close()
})
