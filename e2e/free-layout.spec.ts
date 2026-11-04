import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { openDatabase } from '../src/main/db'
import { WikiStore } from '../src/main/store'
import { launch, makeWorkDir, removeDir, shots } from './app'

const workDir = makeWorkDir()
const dbFile = path.join(workDir, 'Karte.db')
let running: ElectronApplication | null = null

test.afterAll(async () => {
  await running?.close().catch(() => undefined)
  removeDir(workDir)
})

const nodeEl = (page: Page, id: number) => page.locator(`.react-flow__node[data-id="${id}"]`)

/** Lage eines Knotens in Karten-Koordinaten (unabhängig vom Zoom) */
async function flowPos(page: Page, id: number): Promise<{ x: number; y: number }> {
  const transform = await nodeEl(page, id).evaluate((el) => (el as HTMLElement).style.transform)
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(transform)
  if (!m) throw new Error(`Keine Position: ${transform}`)
  return { x: Number(m[1]), y: Number(m[2]) }
}

/** Wartet, bis die Karte nach dem Start die echten Breiten gemessen hat und ruhig steht. */
async function settled(page: Page, id: number): Promise<void> {
  let last = ''
  await expect
    .poll(async () => {
      const now = JSON.stringify(await flowPos(page, id))
      const same = now === last
      last = now
      return same
    }, { intervals: [300] })
    .toBe(true)
}

/** Zieht einen Knoten mit der Maus um (dx, dy) Bildschirmpunkte. */
async function dragBy(page: Page, id: number, dx: number, dy: number): Promise<void> {
  const box = (await nodeEl(page, id).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 8 })
  await page.mouse.move(x + dx, y + dy, { steps: 8 })
  await page.mouse.up()
}

async function dragOnto(page: Page, id: number, targetId: number): Promise<void> {
  const from = (await nodeEl(page, id).boundingBox())!
  const to = (await nodeEl(page, targetId).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await expect(nodeEl(page, targetId).locator('.mm-node')).toHaveClass(/drop-target/)
  await page.mouse.up()
}

const offsets = (): Record<number, [number, number]> => {
  const store = new WikiStore(openDatabase(dbFile, 'Karte'), 'test')
  try {
    return Object.fromEntries(store.getTree().articles.map((a) => [a.id, [a.offsetX, a.offsetY]]))
  } finally {
    store.db.close()
  }
}

test('Artikel in der Mind Map frei verschieben', async () => {
  fs.mkdirSync(workDir, { recursive: true })
  const setup = new WikiStore(openDatabase(dbFile, 'Karte'), 'admin')
  const root = setup.rootId()
  const server = setup.createArticle(root, 'Server')
  const db = setup.createArticle(server, 'Datenbank')
  const net = setup.createArticle(root, 'Netzwerk')
  setup.db.close()

  let { app, page } = await launch(workDir, 'Karte.db')
  running = app
  await settled(page, db)
  const before = { server: await flowPos(page, server), db: await flowPos(page, db), root: await flowPos(page, root) }

  // Ins Freie ziehen: Der Artikel bleibt dort, sein Unterartikel wandert mit
  await dragBy(page, server, 40, -170)
  await settled(page, db)
  const after = { server: await flowPos(page, server), db: await flowPos(page, db), root: await flowPos(page, root) }
  const moved = { x: after.server.x - before.server.x, y: after.server.y - before.server.y }
  expect(Math.abs(moved.y)).toBeGreaterThan(80)
  expect(Math.abs(after.db.x - before.db.x - moved.x)).toBeLessThan(1)
  expect(Math.abs(after.db.y - before.db.y - moved.y)).toBeLessThan(1)
  expect(after.root).toEqual(before.root)
  await page.screenshot({ path: path.join(shots, 'frei-01-verschoben.png') })

  // Für alle gespeichert – auch nach einem Neustart an derselben Stelle
  await app.close()
  expect(Math.abs(offsets()[server][1] - moved.y)).toBeLessThan(1)
  expect(offsets()[db]).toEqual([0, 0])
  ;({ app, page } = await launch(workDir, 'Karte.db'))
  running = app
  await settled(page, server)
  const again = await flowPos(page, server)
  const againRoot = await flowPos(page, root)
  // (gespeichert wird auf ganze Bildpunkte gerundet, Knotenbreiten werden beim Start neu gemessen)
  expect(Math.abs(again.x - againRoot.x - (after.server.x - after.root.x))).toBeLessThan(3)
  expect(Math.abs(again.y - againRoot.y - (after.server.y - after.root.y))).toBeLessThan(3)

  // Auf einen anderen Artikel gezogen: wird wie bisher umgehängt
  await dragOnto(page, net, db)
  await expect(page.locator('.toast.error')).toHaveCount(0)
  await expect.poll(() => (new WikiStore(openDatabase(dbFile, 'Karte'), 't').getTree().articles.find((a) => a.id === net)?.parentId)).toBe(db)

  // Rechtsklick: Ast zurück an den automatischen Platz
  await nodeEl(page, server).click({ button: 'right' })
  await page.locator('.menu').getByRole('button', { name: /Ast automatisch anordnen/ }).click()
  await expect.poll(() => offsets()[server]).toEqual([0, 0])
  await settled(page, server)
  const reset = await flowPos(page, server)
  expect(Math.abs(reset.y - before.server.y)).toBeLessThan(3)

  // Ganze Karte über das Menü (mit Nachfrage)
  await dragBy(page, db, 0, 120)
  await expect.poll(() => offsets()[db][1]).not.toBe(0)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('wiki:event', { type: 'menu', action: 'auto-layout' })
  )
  const ask = page.getByRole('dialog', { name: 'Mind Map automatisch anordnen?' })
  await ask.getByRole('button', { name: 'Automatisch anordnen' }).click()
  await expect.poll(() => Object.values(offsets()).every(([x, y]) => x === 0 && y === 0)).toBe(true)
  await expect(page.locator('.toast.error')).toHaveCount(0)
  await app.close()
})
