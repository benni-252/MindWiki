import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { addChild, launch, makeWorkDir, node, removeDir, shots } from './app'

const workDir = makeWorkDir()
let running: ElectronApplication | null = null

test.afterAll(async () => {
  await running?.close().catch(() => undefined)
  removeDir(workDir)
})

/** Zieht Dateien wie aus dem Explorer auf ein Element. */
async function dropFiles(page: Page, selector: string, files: { name: string; text: string; type: string }[]): Promise<void> {
  const transfer = await page.evaluateHandle((list) => {
    const dt = new DataTransfer()
    for (const f of list) dt.items.add(new File([f.text], f.name, { type: f.type }))
    return dt
  }, files)
  // Wie bei einem echten Drop: mit Mausposition (der Editor braucht sie, um die Stelle zu bestimmen)
  const box = (await page.locator(selector).first().boundingBox())!
  const at = { clientX: box.x + box.width / 2, clientY: box.y + Math.min(box.height / 2, 20) }
  await page.dispatchEvent(selector, 'dragover', { dataTransfer: transfer, ...at })
  await page.dispatchEvent(selector, 'drop', { dataTransfer: transfer, ...at })
}

test('Dokumente an Artikel anhängen, öffnen, speichern und entfernen', async () => {
  const { app, page } = await launch(workDir, 'Anhang.db')
  running = app
  const panel = page.locator('.panel')
  const section = panel.locator('section.attachments')
  const toast = (text: string | RegExp) => page.locator('.toast', { hasText: text })

  await addChild(page, 'Anhang', 'Server')
  await node(page, 'Server').click()
  await expect(section.getByRole('button', { name: /Dokumente anhängen/ })).toBeVisible()

  // Über den Datei-Dialog: Das Handbuch wird angehängt, das Programm abgelehnt
  const manual = path.join(workDir, 'Handbuch Server.pdf')
  const program = path.join(workDir, 'setup.exe')
  fs.writeFileSync(manual, '%PDF-1.7 Handbuch für den Server')
  fs.writeFileSync(program, 'MZ')
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as typeof dialog.showOpenDialog
  }, [manual, program])
  await section.getByRole('button', { name: 'Datei anhängen…' }).click()
  await expect(toast('Datei angehängt.')).toBeVisible()
  await expect(toast('„setup.exe“ kann nicht angehängt werden')).toBeVisible()
  await expect(section.locator('.att-name')).toHaveText(['Handbuch Server.pdf'])
  await expect(section.locator('.att-meta')).toContainText('33 Byte · admin')

  // Aus dem Explorer auf den Bereich gezogen – und ein Word-Dokument auf den Text
  await dropFiles(page, 'section.attachments', [{ name: 'Netzplan.txt', text: 'Switch – Firewall', type: 'text/plain' }])
  await expect(section.locator('.att-name')).toHaveText(['Handbuch Server.pdf', 'Netzplan.txt'])
  await dropFiles(page, '.editor-content .ProseMirror', [
    { name: 'Notiz.docx', text: 'Word', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  ])
  await expect(section.locator('.att-name')).toHaveText(['Handbuch Server.pdf', 'Netzplan.txt', 'Notiz.docx'])
  await expect(node(page, 'Server').locator('.mm-attachments')).toHaveText('3')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'anhaenge-01-liste.png') })

  // Öffnen: schreibgeschützte Kopie mit dem passenden Programm
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[] }
    g.opened = []
    shell.openPath = async (p: string) => {
      g.opened.push(p)
      return ''
    }
  })
  await section.locator('.att-name', { hasText: 'Handbuch Server.pdf' }).click()
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened.length))
    .toBe(1)
  const opened = await app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened[0])
  expect(path.basename(opened)).toBe('Handbuch Server.pdf')
  expect(fs.readFileSync(opened, 'utf8')).toBe('%PDF-1.7 Handbuch für den Server')
  expect(fs.statSync(opened).mode & 0o222).toBe(0)

  // Speichern unter …
  const copy = path.join(workDir, 'Kopie Netzplan.txt')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog
  }, copy)
  await section.getByRole('button', { name: 'Netzplan.txt speichern unter' }).click()
  await expect(toast(`Gespeichert: ${copy}`)).toBeVisible()
  expect(fs.readFileSync(copy, 'utf8')).toBe('Switch – Firewall')

  // Entfernen (mit Nachfrage), im Verlauf vermerkt
  await section.getByRole('button', { name: 'Netzplan.txt entfernen' }).click()
  await page.getByRole('dialog', { name: 'Anhang entfernen?' }).getByRole('button', { name: 'Entfernen' }).click()
  await expect(section.locator('.att-name')).toHaveText(['Handbuch Server.pdf', 'Notiz.docx'])
  await expect(panel.locator('.history-summary').first()).toHaveText('Anhang „Netzplan.txt“ entfernt')
  await expect(node(page, 'Server').locator('.mm-attachments')).toHaveText('2')

  // Lesemodus: öffnen und speichern ja, anhängen und entfernen nein
  await panel.getByTitle(/^Lesemodus/).click()
  await expect(section.locator('.att-name')).toHaveCount(2)
  await expect(section.getByRole('button', { name: 'Datei anhängen…' })).toHaveCount(0)
  await expect(section.getByRole('button', { name: /entfernen$/ })).toHaveCount(0)
  await expect(page.locator('.toast.error', { hasNotText: 'setup.exe' })).toHaveCount(0)
  await app.close()
})
