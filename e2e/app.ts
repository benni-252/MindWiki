import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const shots = path.join(__dirname, '..', 'test-results', 'screens')
fs.mkdirSync(shots, { recursive: true })

/** Eigenes Verzeichnis mit Test-Datenbank pro Testdatei. */
export function makeWorkDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mindwiki-e2e-'))
}

export interface Login {
  username: string
  password: string
}

export const ADMIN: Login = { username: 'admin', password: 'admin' }

/** Meldet sich in der Anmeldemaske an und wartet auf die Mind Map. */
export async function login(page: Page, user: Login): Promise<void> {
  const screen = page.locator('.login-screen')
  await expect(screen).toBeVisible()
  await screen.getByLabel('Benutzername').fill(user.username)
  await screen.getByLabel('Passwort').fill(user.password)
  await screen.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.locator('.mm-node.depth-0')).toBeVisible()
}

/**
 * Startet die gebaute App (npm run build) mit der angegebenen Datenbank statt der echten.
 * Ohne `dbName` startet sie wie nach einer frischen Installation (Ordner über `extraEnv`).
 * `user`: so anmelden (Standard: admin/admin); null bleibt in der Anmeldemaske.
 */
export async function launch(
  workDir: string,
  dbName: string | null,
  extraEnv: Record<string, string> = {},
  user: Login | null = ADMIN
): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ELECTRON_RENDERER_URL' && k !== 'MINDWIKI_DB') env[k] = v
  }
  if (dbName) env.MINDWIKI_DB = path.join(workDir, dbName)
  env.MINDWIKI_USER_DATA = path.join(workDir, 'userData')
  Object.assign(env, extraEnv)
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'out', 'main', 'index.js')], env })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1400, height: 860 })
  await expect(page.locator('.login-screen')).toBeVisible()
  if (user) await login(page, user)
  return { app, page }
}

export const node = (page: Page, title: string) => page.locator('.mm-node', { hasText: title }).first()

/** Neuer Unterartikel per Tab-Taste, direkt umbenannt. */
export async function addChild(page: Page, parent: string, title: string): Promise<void> {
  await node(page, parent).click()
  await page.keyboard.press('Tab')
  await rename(page, title)
}

/** Füllt das gerade offene Umbenennen-Feld eines Knotens. */
export async function rename(page: Page, title: string): Promise<void> {
  const input = page.locator('.mm-rename')
  await expect(input).toBeFocused()
  await input.fill(title)
  await input.press('Enter')
  await expect(node(page, title)).toBeVisible()
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
