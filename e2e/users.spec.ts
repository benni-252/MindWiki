import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import { addChild, launch, login, makeWorkDir, node, removeDir, shots } from './app'

const workDir = makeWorkDir()
let running: ElectronApplication | null = null

test.afterAll(async () => {
  await running?.close().catch(() => undefined)
  removeDir(workDir)
})

async function logout(page: Page): Promise<void> {
  await page.locator('.user-chip').click()
  await page.getByRole('menu').getByRole('button', { name: 'Abmelden' }).click()
  await expect(page.locator('.login-screen')).toBeVisible()
}

async function openUserMenuItem(page: Page, name: string): Promise<void> {
  await page.locator('.user-chip').click()
  await page.getByRole('menu').getByRole('button', { name }).click()
}

test('Anmeldung, Benutzerverwaltung, Rollen und gelöschte Benutzer', async () => {
  const { app, page } = await launch(workDir, 'Firma.db', {}, null)
  running = app

  // Frisches Wiki: Hinweis auf den Start-Zugang, falsches Passwort wird abgewiesen
  const screen = page.locator('.login-screen')
  await expect(screen.locator('.login-hint')).toContainText('Benutzer admin, Passwort admin')
  await expect(screen.getByLabel('Benutzername')).toHaveValue('admin')
  await screen.getByLabel('Passwort').fill('falsch')
  await screen.getByRole('button', { name: 'Anmelden' }).click()
  await expect(screen.locator('.login-error')).toHaveText('Benutzername oder Passwort stimmt nicht.')
  await page.screenshot({ path: path.join(shots, 'benutzer-01-anmeldung.png') })
  await login(page, { username: 'admin', password: 'admin' })

  // Admin ändert sein Start-Passwort
  const bar = page.locator('.notice-bar.warning')
  await expect(bar).toContainText('Das Admin-Passwort ist noch „admin“')
  await bar.getByRole('button', { name: 'Passwort ändern…' }).click()
  const pw = page.getByRole('dialog', { name: 'Passwort ändern' })
  await pw.getByLabel('Bisheriges Passwort').fill('admin')
  await pw.getByLabel('Neues Passwort', { exact: true }).fill('geheim1')
  await pw.getByLabel('Neues Passwort wiederholen').fill('geheim1')
  await pw.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.locator('.toast', { hasText: 'Passwort geändert.' })).toBeVisible()
  await expect(bar).toHaveCount(0)

  // Admin legt eine Mitarbeiterin und einen Bearbeiter an
  await openUserMenuItem(page, 'Benutzer verwalten')
  const users = page.getByRole('dialog', { name: 'Benutzer verwalten' })
  const row = (name: string) => users.locator('.users-table tbody tr').filter({ has: page.getByText(name, { exact: true }) })
  const add = async (name: string, password: string, role: string): Promise<void> => {
    await users.getByLabel('Benutzername').fill(name)
    await users.getByLabel('Passwort', { exact: true }).fill(password)
    await users.getByLabel('Rolle', { exact: true }).selectOption({ label: role })
    await users.getByRole('button', { name: 'Anlegen' }).click()
    await expect(row(name)).toBeVisible()
  }
  await add('mia', 'mia1', 'Mitarbeiter – verfasst und ändert Artikel')
  await add('ben', 'ben1', 'Bearbeiter – verfasst und gibt frei')
  await expect(users.locator('.users-table tbody tr')).toHaveCount(3)
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'benutzer-02-verwaltung.png') })
  await users.getByRole('button', { name: 'Fertig' }).click()

  // Admin schaltet die Freigabe-Pflicht ein
  await openUserMenuItem(page, 'Freigaben einstellen')
  const approvals = page.getByRole('dialog', { name: 'Freigaben' })
  await approvals.getByRole('checkbox').click()
  await page.getByRole('dialog', { name: 'Freigabe-Pflicht einschalten?' }).getByRole('button', { name: 'Einschalten' }).click()
  await approvals.getByRole('button', { name: 'Fertig' }).click()
  await logout(page)

  // Mitarbeiterin schreibt einen Artikel, darf aber weder freigeben noch Benutzer verwalten
  await login(page, { username: 'mia', password: 'mia1' })
  await expect(page.locator('.user-chip')).toContainText('Mitarbeiter')
  await addChild(page, 'Firma', 'Drucker-Anleitung')
  await node(page, 'Drucker-Anleitung').click()
  await expect(page.locator('.approval-box.new')).toContainText('Ein Bearbeiter (nicht du selbst) muss ihn freigeben')
  await page.locator('.user-chip').click()
  await expect(page.getByRole('menu').getByRole('button', { name: 'Benutzer verwalten' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.locator('.approval-pill').click()
  await expect(approvals.getByRole('checkbox')).toBeDisabled()
  await approvals.getByRole('button', { name: 'Fertig' }).click()
  await logout(page)

  // Bearbeiter gibt frei
  await login(page, { username: 'ben', password: 'ben1' })
  await expect(page.locator('.approval-pill.for-me')).toHaveText('1 Freigabe offen')
  await node(page, 'Drucker-Anleitung').click()
  await page.locator('.approval-box.new').getByRole('button', { name: 'Freigeben' }).click()
  await expect(node(page, 'Drucker-Anleitung')).not.toHaveClass(/\bdraft\b/)
  await logout(page)

  // Admin löscht die Mitarbeiterin – ihr Artikel bleibt und wird gekennzeichnet
  await login(page, { username: 'admin', password: 'geheim1' })
  await openUserMenuItem(page, 'Benutzer verwalten')
  await users.getByTitle('mia löschen').click()
  await page.getByRole('dialog', { name: '„mia“ löschen?' }).getByRole('button', { name: 'Löschen' }).click()
  await expect(row('mia')).toContainText('(gelöscht)')
  await users.getByRole('button', { name: 'Fertig' }).click()
  await expect(node(page, 'Drucker-Anleitung')).toHaveClass(/\bauthor-deleted\b/)
  await expect(node(page, 'Drucker-Anleitung')).toHaveAttribute('title', /Autor „mia“ wurde gelöscht/)
  await node(page, 'Drucker-Anleitung').click()
  await expect(page.locator('.author-deleted-note')).toHaveText('Verfasst von mia – dieser Benutzer wurde gelöscht.')
  await expect(page.locator('.history-list .deleted-name').first()).toHaveText('mia')
  await page.screenshot({ path: path.join(shots, 'benutzer-03-geloescht.png') })
  await logout(page)

  // Gelöschte Benutzer können sich nicht mehr anmelden
  await screen.getByLabel('Benutzername').fill('mia')
  await screen.getByLabel('Passwort').fill('mia1')
  await screen.getByRole('button', { name: 'Anmelden' }).click()
  await expect(screen.locator('.login-error')).toHaveText('Benutzername oder Passwort stimmt nicht.')
  await expect(page.locator('.toast.error')).toHaveCount(0)
  await app.close()
})
