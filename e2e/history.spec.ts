import { expect, test, type ElectronApplication } from '@playwright/test'
import path from 'node:path'
import { openDatabase } from '../src/main/db'
import { WikiStore } from '../src/main/store'
import { addChild, launch, makeWorkDir, node, removeDir, shots } from './app'

const workDir = makeWorkDir()
const dbFile = path.join(workDir, 'Team.db')
let running: ElectronApplication | null = null
let colleague: WikiStore | null = null

test.afterAll(async () => {
  colleague?.db.close()
  await running?.close().catch(() => undefined)
  removeDir(workDir)
})

const textDoc = (text: string): string =>
  JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

test('Verlauf und Änderungen von anderen an derselben Datei', async () => {
  const { app, page } = await launch(workDir, 'Team.db')
  running = app

  // Eigenen Namen für den Verlauf festlegen
  await page.getByTitle(/Letzte Änderungen/).click()
  const changes = page.getByRole('dialog', { name: 'Letzte Änderungen' })
  await changes.getByRole('button', { name: /Du erscheinst als/ }).click()
  const nameInput = page.getByRole('textbox', { name: 'Dein Name' })
  await nameInput.fill('Benjamin')
  await nameInput.press('Enter')
  await expect(page.locator('.toast', { hasText: 'Deine Änderungen erscheinen jetzt als „Benjamin“.' })).toBeVisible()

  // Artikel mit Text anlegen
  await addChild(page, 'Team', 'Firewall')
  await node(page, 'Firewall').click()
  const editor = page.locator('.editor-content .ProseMirror')
  await editor.click()
  await page.keyboard.type('Regel A erlaubt VPN.')
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 5000 })
  await expect(page.locator('.history-list li').first()).toContainText('Benjamin')
  await expect(page.locator('.history-summary')).toHaveText(['Text bearbeitet', 'Angelegt'])
  await expect(page.locator('.meta')).toContainText('von Benjamin')
  await page.keyboard.press('Escape')
  await node(page, 'Firewall').click()
  await page.locator('.panel').getByTitle(/^Schließen/).click()

  // Ein Kollege öffnet dieselbe Datei auf seinem Rechner und ändert etwas
  colleague = new WikiStore(openDatabase(dbFile, 'Team'), 'Kollege')
  const fw = colleague.getTree().articles.find((a) => a.title === 'Firewall')!.id
  colleague.addField(fw, 'IP-Adresse', '10.0.0.1')
  colleague.saveArticleContent(fw, textDoc('Regel B sperrt alles.'), 'Regel B sperrt alles.')

  // Die App bemerkt das von selbst: Punkt am Knoten und Zähler in der Kopfleiste
  await expect(node(page, 'Firewall').locator('.mm-news')).toBeVisible({ timeout: 8000 })
  await expect(node(page, 'Firewall')).toHaveAttribute('title', /Neu geändert von Kollege/)
  await expect(page.locator('.badge-host .badge')).toHaveText('1')
  await page.screenshot({ path: path.join(shots, 'verlauf-01-markierung.png') })

  // Liste der neuen Änderungen
  await page.locator('.badge-host').click()
  await expect(changes.getByRole('tab', { name: 'Neu von anderen (2)' })).toHaveAttribute('aria-selected', 'true')
  await expect(changes.locator('.change-list li.unseen .change-summary')).toHaveText([
    'Text bearbeitet',
    'Feld „IP-Adresse“ hinzugefügt: „10.0.0.1“'
  ])
  await expect(changes.locator('.change-meta').first()).toContainText('Kollege')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'verlauf-02-liste.png') })
  await changes.locator('.change-title', { hasText: 'Firewall' }).first().click()

  // Im Artikel: neuer Text, markierter Verlauf; danach gilt alles als gesehen
  await expect(editor).toContainText('Regel B sperrt alles.')
  await expect(page.locator('.history-list li.unseen')).toHaveCount(2)
  await expect(page.locator('.history-list li.unseen .new-tag')).toHaveCount(2)
  await expect(node(page, 'Firewall').locator('.mm-news')).toHaveCount(0)
  await expect(page.locator('.badge-host .badge')).toHaveCount(0)
  await page.screenshot({ path: path.join(shots, 'verlauf-03-artikel.png') })

  // Frühere Fassung ansehen und zurückholen
  await page.locator('.history-list li', { hasText: 'Kollege' }).getByRole('button', { name: 'Text davor ansehen' }).click()
  const version = page.getByRole('dialog', { name: 'Text vor dieser Änderung' })
  await expect(version.locator('.version-view')).toContainText('Regel A erlaubt VPN.')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'verlauf-04-fassung.png') })
  await version.getByRole('button', { name: 'Diese Fassung wiederherstellen' }).click()
  await page.getByRole('dialog', { name: 'Diese Fassung wiederherstellen?' }).getByRole('button', { name: 'Wiederherstellen' }).click()
  await expect(editor).toContainText('Regel A erlaubt VPN.')
  await expect(page.locator('.history-summary').first()).toHaveText(
    /^Text auf die Fassung vor der Änderung von Kollege \(.+\) zurückgesetzt$/
  )

  // Während der Artikel offen ist, ändert der Kollege den Titel: Die Ansicht folgt sofort
  colleague.renameArticle(fw, 'Firewall Zentrale')
  await expect(page.locator('.panel .article-title')).toHaveValue('Firewall Zentrale', { timeout: 8000 })
  await expect(page.locator('.toast', { hasText: '„Firewall Zentrale“ wurde von Kollege geändert.' })).toBeVisible()
  await expect(node(page, 'Firewall Zentrale').locator('.mm-news')).toHaveCount(0)

  // Der Kollege sieht umgekehrt, was Benjamin getan hat
  expect(colleague.getChanges(fw).map((c) => c.author)).toContain('Benjamin')
  await expect(page.locator('.toast.error')).toHaveCount(0)
  await app.close()
})
