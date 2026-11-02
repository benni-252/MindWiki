import { expect, test, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
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

test('Freigabe neuer Artikel und Änderungen nach dem Vier-Augen-Prinzip', async () => {
  // Der Admin hat Benjamin als Bearbeiter angelegt und die Freigabe-Pflicht eingeschaltet
  fs.mkdirSync(workDir, { recursive: true })
  const setup = new WikiStore(openDatabase(dbFile, 'Team'), 'admin')
  setup.createUser('Benjamin', 'benjamin', 'editor')
  setup.setApprovalRequired(true)
  setup.db.close()
  const { app, page } = await launch(workDir, 'Team.db', {}, { username: 'Benjamin', password: 'benjamin' })
  running = app
  const approvals = page.getByRole('dialog', { name: 'Freigaben' })

  // Neuer Artikel ist ein Entwurf; die Autorin darf ihn bearbeiten, aber nicht freigeben
  await addChild(page, 'Team', 'Firewall')
  await expect(node(page, 'Firewall')).toHaveClass(/\bdraft\b/)
  await node(page, 'Firewall').click()
  await expect(page.locator('.approval-box.new')).toContainText('Neuer Artikel – wartet auf Freigabe')
  await expect(page.locator('.approval-box.new').getByRole('button', { name: 'Freigeben' })).toHaveCount(0)
  const editor = page.locator('.editor-content .ProseMirror')
  await editor.click()
  await page.keyboard.type('Regel A erlaubt VPN.')
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 5000 })
  // Der ganze Text ist als nicht freigegeben markiert, oben wartet der eigene Entwurf
  await expect(page.locator('.editor.unapproved-all .unapproved-label')).toHaveText('Text noch nicht freigegeben')
  await expect(page.locator('.approval-pill.mine')).toHaveText('1 Freigabe offen')
  await expect(page.locator('.approval-pill.mine')).toHaveAttribute('title', '1 eigener Entwurf wartet auf andere')

  // Ein Kollege gibt den Artikel an seinem Rechner frei
  colleague = new WikiStore(openDatabase(dbFile, 'Team'), 'Kollege')
  const fw = colleague.getTree().articles.find((a) => a.title === 'Firewall')!.id
  colleague.approve(fw)
  await expect(node(page, 'Firewall')).not.toHaveClass(/\bdraft\b/, { timeout: 8000 })
  await expect(page.locator('.approval-pill')).toHaveCount(0)
  await expect(page.locator('.editor.unapproved')).toHaveCount(0)

  // Ab jetzt nur noch über einen Entwurf änderbar
  await expect(page.locator('.approval-hint')).toBeVisible()
  await expect(editor).toHaveAttribute('contenteditable', 'false')
  await page.locator('.approval-hint').getByRole('button', { name: 'Bearbeiten' }).click()
  await expect(page.locator('.approval-box.mine')).toContainText('Dein Entwurf')
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  await editor.click()
  await page.keyboard.press('End')
  await expect(page.locator('.editor.unapproved-changes .unapproved-block')).toHaveCount(0)
  await page.keyboard.type(' Regel B sperrt Telnet.')
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 5000 })
  // Der geänderte Absatz ist markiert
  await expect(page.locator('.editor.unapproved-changes .unapproved-block')).toHaveCount(1)
  await expect(page.locator('.unapproved-block')).toContainText('Regel B sperrt Telnet.')
  const title = page.locator('.panel .article-title')
  await title.fill('Firewall Zentrale')
  await title.press('Enter')
  await expect(node(page, 'Firewall Zentrale').locator('.mm-pending')).toBeVisible()
  await page.screenshot({ path: path.join(shots, 'freigabe-01-entwurf.png') })

  // Der Kollege sieht weiter den alten Stand und vergleicht
  expect(colleague.getTree().articles.find((a) => a.id === fw)).toMatchObject({ title: 'Firewall', draftBy: 'Benjamin' })
  const diff = colleague.getDraftDiff(fw)!
  expect(diff.title).toEqual({ before: 'Firewall', after: 'Firewall Zentrale' })
  expect(diff.text?.after).toContain('Regel B sperrt Telnet.')
  colleague.approve(fw)
  await expect(page.locator('.approval-box.mine')).toHaveCount(0, { timeout: 8000 })
  await expect(node(page, 'Firewall Zentrale').locator('.mm-pending')).toHaveCount(0)
  await expect(editor).toContainText('Regel B sperrt Telnet.')
  await expect(page.locator('.history-list li').first()).toContainText('Änderungen von Benjamin freigegeben')
  await expect(page.locator('.history-list li').first()).toContainText('Kollege')

  // Jetzt schlägt der Kollege eine Änderung vor: Zähler oben, Liste, Vergleich, Freigabe
  colleague.renameArticle(fw, 'Firewall Nord')
  await expect(page.locator('.approval-pill.for-me')).toHaveText('1 Freigabe offen', { timeout: 8000 })
  await expect(node(page, 'Firewall Zentrale').locator('.mm-pending')).toBeVisible()
  await page.locator('.approval-pill').click()
  await expect(approvals.locator('.approval-list li')).toContainText(['Firewall Zentrale'])
  await approvals.locator('.change-title', { hasText: 'Firewall Zentrale' }).click()
  const pending = page.locator('.approval-box.pending')
  await expect(pending).toContainText('Kollege hat Änderungen vorgeschlagen')
  await pending.getByRole('button', { name: 'Änderungen ansehen' }).click()
  const diffDialog = page.getByRole('dialog', { name: 'Änderungen ansehen' })
  await expect(diffDialog.locator('.diff-line.removed')).toHaveText('Firewall Zentrale')
  await expect(diffDialog.locator('.diff-line.added')).toHaveText('Firewall Nord')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'freigabe-02-vergleich.png') })
  await diffDialog.getByRole('button', { name: 'Freigeben' }).click()
  await expect(node(page, 'Firewall Nord')).toBeVisible()
  await expect(page.locator('.approval-pill')).toHaveCount(0)

  // Neuer Artikel des Kollegen wird abgelehnt und landet im Papierkorb
  colleague.createArticle(colleague.rootId(), 'Testseite')
  await expect(node(page, 'Testseite')).toHaveClass(/\bdraft\b/, { timeout: 8000 })
  await node(page, 'Testseite').click()
  await expect(page.locator('.approval-box.new')).toContainText('Neuer Artikel von Kollege')
  await page.screenshot({ path: path.join(shots, 'freigabe-03-neu-von-kollege.png') })
  await page.locator('.approval-box.new').getByRole('button', { name: 'Ablehnen' }).click()
  const rejectDialog = page.getByRole('dialog', { name: 'Ablehnen' })
  await rejectDialog.getByLabel('Grund').fill('Gibt es schon')
  await rejectDialog.getByRole('button', { name: 'Ablehnen' }).click()
  await expect(node(page, 'Testseite')).toHaveCount(0)
  expect(colleague.listTrash().map((t) => t.title)).toEqual(['Testseite'])

  await expect(page.locator('.toast.error')).toHaveCount(0)
  await app.close()
})
