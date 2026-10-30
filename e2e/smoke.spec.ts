/// <reference lib="dom" />
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { addChild, launch as launchApp, makeWorkDir, node, removeDir, shots } from './app'

const workDir = makeWorkDir()
let running: ElectronApplication | null = null

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const started = await launchApp(workDir, 'Smoke.db')
  running = started.app
  return started
}

test.afterAll(async () => {
  await running?.close().catch(() => undefined)
  removeDir(workDir)
})

test('Mind Map, Artikel, Abläufe und Persistenz', async () => {
  let { app, page } = await launch()
  await expect(node(page, 'Smoke')).toBeVisible()

  // Baum per Tastatur aufbauen
  await addChild(page, 'Smoke', 'Netzwerk')
  await addChild(page, 'Netzwerk', 'Drucker')
  await addChild(page, 'Smoke', 'Backup')
  await addChild(page, 'Smoke', 'Server')
  await addChild(page, 'Server', 'Wartung')
  await page.screenshot({ path: path.join(shots, '01-mindmap.png') })

  // Ein Knoten am rechten Rand bleibt sichtbar, wenn sich das Panel öffnet
  await page.keyboard.press('Control+0')
  await page.waitForTimeout(500)
  await node(page, 'Drucker').click()
  await expect(page.locator('.panel .article-title')).toHaveValue('Drucker')
  await page.waitForTimeout(600)
  const nodeBox = (await node(page, 'Drucker').boundingBox())!
  const mapBox = (await page.locator('.mm-wrapper').boundingBox())!
  expect(nodeBox.x + nodeBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width)

  // Öffnen allein ändert nichts
  await page.waitForTimeout(900)
  await expect(page.locator('.save-status')).toHaveText('Gespeichert')

  // Artikel bearbeiten, Querverweis per [[ setzen
  const editor = page.locator('.editor-content .ProseMirror')
  await editor.click()
  await page.keyboard.type('Der Drucker steht im Büro. Siehe ')
  await page.keyboard.type('[[Back')
  await expect(page.locator('.suggestions button', { hasText: 'Backup' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(editor.locator('.article-link', { hasText: 'Backup' })).toBeVisible()
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 5000 })
  await expect(page.locator('.react-flow__edge.xref-edge')).toHaveCount(1)

  // Bild per Zwischenablage einfügen (wie ein Screenshot mit Strg+V)
  await editor.press('End')
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = 20
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#e8590c'
    ctx.fillRect(0, 0, 40, 20)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b: Blob | null) => resolve(b!), 'image/png'))
    const data = new DataTransfer()
    data.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }))
    document
      .querySelector('.editor-content .ProseMirror')!
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  const image = editor.locator('img[src^="wikiimg://img/"]')
  await expect(image).toHaveCount(1)
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(40)
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 5000 })

  // Ablauf anlegen und abhaken
  await page.getByRole('button', { name: 'Ablauf' }).click()
  const title = page.locator('input.checklist-title')
  await expect(title).toBeFocused()
  await title.fill('Papier nachfüllen')
  await title.press('Enter')
  const add = page.locator('.step-add')
  await expect(add).toBeFocused()
  await add.fill('Fach öffnen')
  await add.press('Enter')
  await add.fill('Papier einlegen')
  await add.press('Enter')
  await expect(page.locator('.step')).toHaveCount(2)
  await page.locator('.step input[type=checkbox]').first().check()
  await expect(page.locator('.checklist-count')).toHaveText('1/2')
  await expect(node(page, 'Drucker').locator('.mm-badge')).toHaveText('1/2')
  await page.screenshot({ path: path.join(shots, '02-artikel.png') })

  // Neu starten: alles muss noch da sein
  await app.close()
  ;({ app, page } = await launch())
  for (const t of ['Netzwerk', 'Drucker', 'Backup', 'Server', 'Wartung']) await expect(node(page, t)).toBeVisible()
  await expect(page.locator('.react-flow__edge.xref-edge')).toHaveCount(1)
  await node(page, 'Drucker').click()
  await expect(page.locator('.editor-content')).toContainText('steht im Büro')
  await expect(page.locator('.editor-content .article-link')).toHaveText('Backup')
  await expect.poll(() =>
    page.locator('.editor-content img').evaluate((img: HTMLImageElement) => img.naturalWidth)
  ).toBe(40)
  await expect(page.locator('.step input[type=checkbox]').first()).toBeChecked()

  // Durchlauf protokollieren
  await page.getByTitle('Durchlauf abschließen und protokollieren').click()
  await page.locator('.complete-form textarea').fill('Testlauf')
  await page.getByRole('button', { name: 'Protokollieren & zurücksetzen' }).click()
  await expect(page.locator('.run-count')).toHaveText('1/2 erledigt')
  await expect(page.locator('.run-note')).toHaveText('Testlauf')
  await expect(page.locator('.checklist-count')).toHaveText('0/2')

  // Backlink im verlinkten Artikel
  await page.locator('.editor-content .article-link').click()
  await expect(page.locator('.panel .article-title')).toHaveValue('Backup')
  await expect(page.locator('.link-group', { hasText: 'Wird referenziert von' })).toContainText('Drucker')

  // Ast einklappen und wieder aufklappen
  await node(page, 'Server').click()
  await page.keyboard.press('Space')
  await expect(node(page, 'Wartung')).toHaveCount(0)
  await expect(node(page, 'Server').locator('.mm-toggle')).toHaveText('+1')
  await page.keyboard.press('Space')
  await expect(node(page, 'Wartung')).toBeVisible()

  // Suche
  await page.keyboard.press('Control+K')
  await page.locator('.search-input input').fill('büro')
  await expect(page.locator('.search-hit')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(page.locator('.panel .article-title')).toHaveValue('Drucker')

  // Papierkorb: löschen und wiederherstellen (die Suche hat die Karte verschoben)
  await page.keyboard.press('Control+0')
  await page.waitForTimeout(500)
  await node(page, 'Server').click()
  await page.keyboard.press('Delete')
  await page.getByRole('button', { name: 'In den Papierkorb' }).click()
  await expect(node(page, 'Server')).toHaveCount(0)
  await expect(node(page, 'Wartung')).toHaveCount(0)
  await page.getByTitle('Papierkorb').click()
  await expect(page.locator('.trash-list li')).toHaveCount(1)
  await page.getByRole('button', { name: 'Wiederherstellen' }).click()
  await page.getByRole('button', { name: 'Fertig' }).click()
  await expect(node(page, 'Server')).toBeVisible()
  await expect(node(page, 'Wartung')).toBeVisible()

  await node(page, 'Drucker').click()
  await page.waitForTimeout(900)
  await expect(page.locator('.save-status')).toHaveText('Gespeichert')
  await expect(page.locator('.toast.error')).toHaveCount(0)
  await page.screenshot({ path: path.join(shots, '03-nach-neustart.png') })
  await app.close()

  // Automatische Tagessicherung wurde beim zweiten Start angelegt
  expect(fs.readdirSync(path.join(workDir, 'Sicherungen')).length).toBe(1)
})
