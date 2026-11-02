import { expect, test, type ElectronApplication } from '@playwright/test'
import path from 'node:path'
import type { UpdateState } from '../src/shared/types'
import { launch, makeWorkDir, removeDir, shots } from './app'

const workDir = makeWorkDir()
let running: ElectronApplication | null = null

test.afterAll(async () => {
  await running?.close().catch(() => undefined)
  removeDir(workDir)
})

test('Hinweis und Dialog für neue Versionen', async () => {
  const { app, page } = await launch(workDir, 'Update.db')
  running = app
  const send = (state: UpdateState): Promise<void> =>
    app.evaluate(({ BrowserWindow }, s) => {
      BrowserWindow.getAllWindows()[0].webContents.send('wiki:event', { type: 'update', state: s })
    }, state)

  // Ohne Installation (Entwicklung/Test) gibt es keine Updates – der Dialog erklärt das
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('wiki:event', { type: 'menu', action: 'check-updates' })
  )
  const dialog = page.getByRole('dialog', { name: 'Updates' })
  await expect(dialog).toContainText('nur in der installierten Windows-Version')
  await dialog.locator('footer').getByRole('button', { name: 'Schließen' }).click()
  await expect(page.locator('.update-pill')).toHaveCount(0)

  // Die installierte Version meldet eine neue Version (simuliert)
  await send({ status: 'available', current: '1.4.0', version: '1.5.0', canInstall: true })
  await expect(page.locator('.update-pill')).toHaveText('Update 1.5.0 verfügbar')
  await page.locator('.update-pill').click()
  await expect(dialog).toContainText('Version 1.5.0 ist verfügbar – du hast 1.4.0.')
  await expect(dialog.getByRole('button', { name: 'Herunterladen und installieren' })).toBeVisible()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'update-01-verfuegbar.png') })

  await send({ status: 'downloading', current: '1.4.0', version: '1.5.0', canInstall: true, percent: 42 })
  await expect(dialog).toContainText('42 %')
  await expect(page.locator('.update-pill')).toHaveText('Update wird geladen … 42 %')

  await send({ status: 'ready', current: '1.4.0', version: '1.5.0', canInstall: true })
  await expect(dialog.getByRole('button', { name: 'Jetzt neu starten' })).toBeVisible()
  await expect(page.locator('.update-pill')).toHaveText('Neu starten zum Aktualisieren')
  await dialog.getByRole('button', { name: 'Später' }).click()

  // Portable Version: nur Download-Seite
  await send({ status: 'available', current: '1.4.0', version: '1.5.0', canInstall: false })
  await page.locator('.update-pill').click()
  await expect(dialog).toContainText('portable Version')
  await expect(dialog.getByRole('button', { name: 'Herunterladen und installieren' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Download-Seite öffnen' })).toBeVisible()
  await app.close()
})
