import { expect, test, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { launch, makeWorkDir, node, removeDir, rename, shots } from './app'

const workDir = makeWorkDir()
let running: ElectronApplication | null = null

test.afterAll(async () => {
  await running?.close().catch(() => undefined)
  removeDir(workDir)
})

/** Text aus einem PDF lesen, falls pdftotext installiert ist. */
function pdfText(file: string): string | null {
  try {
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
  } catch {
    return null
  }
}

test('Artikel als PDF exportieren', async () => {
  const { app, page } = await launch(workDir, 'Export.db')
  running = app

  // Artikel mit Steckbrief, Text und Ablauf aus der Server-Vorlage
  await node(page, 'Export').click({ button: 'right' })
  await page.getByRole('button', { name: 'Unterartikel aus Vorlage' }).click()
  await page.getByRole('menuitem', { name: /Server \/ System/ }).click()
  await rename(page, 'SRV-DC01')
  await node(page, 'SRV-DC01').click()
  const ip = page.locator('.fs-value input[aria-label="Wert für IP-Adresse"]')
  await ip.fill('10.0.10.10')
  await ip.press('Enter')
  const pw = page.locator('.fs-head').getByRole('button', { name: 'Feld' })
  await pw.click()
  const label = page.locator('.factsheet input.fs-label').last()
  await label.fill('Passwort')
  await label.press('Enter')
  await page.locator('.fs-value input[aria-label="Wert für Passwort"]').fill('streng-geheim')
  await page.locator('.fs-value input[aria-label="Wert für Passwort"]').press('Enter')
  const editor = page.locator('.editor-content .ProseMirror')
  await editor.locator('h2', { hasText: 'Überblick' }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Domain Controller für das ganze Haus.')
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 5000 })

  // Speichern-Dialog im Hauptprozess durch einen festen Pfad ersetzen
  const pdfFile = path.join(workDir, 'SRV-DC01.pdf')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog
  }, pdfFile)

  await page.getByTitle('Als PDF exportieren (Strg+P)').click()
  await expect(page.locator('.toast', { hasText: `Als PDF gespeichert: ${pdfFile}` })).toBeVisible({ timeout: 20000 })
  const bytes = fs.readFileSync(pdfFile)
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect(bytes.length).toBeGreaterThan(5000)

  fs.copyFileSync(pdfFile, path.join(shots, 'export-SRV-DC01.pdf'))
  const text = pdfText(pdfFile)
  if (text !== null) {
    expect(text).toContain('SRV-DC01')
    expect(text).toContain('Export')
    expect(text).toContain('10.0.10.10')
    expect(text).toContain('Domain Controller für das ganze Haus.')
    expect(text).toContain('Wartung / Neustart')
    expect(text).not.toContain('streng-geheim')
    // Seitenzahl im Fuß
    expect(text).toMatch(/1\s*\/\s*1/)
  }

  // Auch per Rechtsklick in der Mind Map
  const second = path.join(workDir, 'Export.pdf')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog
  }, second)
  await node(page, 'Export').click({ button: 'right' })
  await page.locator('.menu').getByRole('button', { name: /Als PDF exportieren/ }).click()
  await expect(page.locator('.toast', { hasText: `Als PDF gespeichert: ${second}` })).toBeVisible({ timeout: 20000 })
  expect(fs.existsSync(second)).toBe(true)

  await expect(page.locator('.toast.error')).toHaveCount(0)
  await app.close()
})
