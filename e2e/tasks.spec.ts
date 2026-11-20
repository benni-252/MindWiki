import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import { openDatabase } from '../src/main/db'
import { WikiStore } from '../src/main/store'
import { launch, login, makeWorkDir, removeDir, shots } from './app'

const workDir = makeWorkDir()
const dbFile = path.join(workDir, 'Team.db')
let running: ElectronApplication | null = null

test.afterAll(async () => {
  await running?.close().catch(() => undefined)
  removeDir(workDir)
})

const card = (page: Page, title: string) => page.locator('.task-card', { hasText: title })
const column = (page: Page, title: string) =>
  page.locator('.board-col', { has: page.locator('.col-head h2', { hasText: new RegExp(`^${title}$`) }) })

function readBoard() {
  const store = new WikiStore(openDatabase(dbFile, 'Team'), 'test')
  try {
    return store.tasks.getTaskBoard()
  } finally {
    store.db.close()
  }
}

test('Aufgaben wie im Planner: Buckets, Karten, Details, Ziehen, Gruppieren, Filter', async () => {
  const setup = new WikiStore(openDatabase(dbFile, 'Team'), 'admin')
  const server = setup.createArticle(setup.rootId(), 'SRV-SQL01')
  setup.createUser('Ben', 'demo', 'author')
  setup.db.close()

  let { app, page } = await launch(workDir, 'Team.db')
  running = app

  // Reiter wechseln: noch leer
  await page.getByRole('button', { name: 'Aufgaben', exact: true }).click()
  await expect(page.locator('.board-empty')).toBeVisible()
  await expect(page.locator('.workspace')).toHaveClass(/behind/)

  // Buckets anlegen
  for (const name of ['Zu erledigen', 'Diese Woche']) {
    await page.getByRole('button', { name: 'Neuen Bucket hinzufügen' }).click()
    await page.getByLabel('Name des neuen Buckets').fill(name)
    await page.keyboard.press('Enter')
    await expect(column(page, name)).toBeVisible()
  }
  await expect(page.locator('.board-empty')).toHaveCount(0)

  // Aufgaben hinzufügen – das Formular bleibt offen, neue stehen oben
  const todo = column(page, 'Zu erledigen')
  await todo.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()
  await todo.getByLabel('Name der neuen Aufgabe').fill('Backup prüfen')
  await page.keyboard.press('Enter')
  await expect(card(page, 'Backup prüfen')).toBeVisible()
  await todo.getByLabel('Name der neuen Aufgabe').fill('Server patchen')
  await page.keyboard.press('Enter')
  await expect(todo.locator('.task-title')).toHaveText(['Server patchen', 'Backup prüfen'])
  await page.keyboard.press('Escape')
  await expect(todo.locator('.add-task-form')).toHaveCount(0)

  // Details: Priorität, Fälligkeit, Zuweisung, Bezeichnung, Checkliste, Artikel, Notiz, Kommentar
  await card(page, 'Server patchen').locator('.task-title').click()
  const dialog = page.locator('.task-modal')
  await expect(dialog).toBeVisible()
  await dialog.locator('label', { hasText: 'Priorität' }).locator('select').selectOption('urgent')
  await dialog.locator('label', { hasText: 'Fälligkeitsdatum' }).locator('input').fill('2030-01-15')

  await dialog.getByRole('button', { name: 'Zuweisen', exact: true }).click()
  await dialog.getByRole('dialog', { name: 'Zuweisen' }).getByRole('button', { name: 'Ben' }).click()
  await expect(dialog.locator('.td-person')).toContainText('Ben')
  // Esc schließt erst das Auswahlfeld, nicht den Dialog
  await page.keyboard.press('Escape')
  await expect(dialog.getByRole('dialog', { name: 'Zuweisen' })).toHaveCount(0)
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'Bezeichnung hinzufügen' }).click()
  await dialog.getByLabel('Neue Bezeichnung').fill('Server')
  await dialog.getByRole('button', { name: 'Anlegen' }).click()
  await expect(dialog.locator('.td-labels > .label-chip')).toContainText('Server')
  await page.keyboard.press('Escape')

  const addItem = dialog.getByLabel('Element zur Checkliste hinzufügen')
  await addItem.fill('Updates einspielen')
  await addItem.press('Enter')
  await addItem.fill('Neustart')
  await addItem.press('Enter')
  await expect(dialog.locator('.td-check')).toHaveCount(2)
  await dialog.getByLabel('Updates einspielen erledigt').check()

  await dialog.getByRole('button', { name: 'Artikel verknüpfen' }).click()
  await dialog.getByLabel('Artikel suchen').fill('sql')
  await page.keyboard.press('Enter')
  await expect(dialog.locator('.td-article')).toContainText('SRV-SQL01')

  await dialog.getByLabel('Notizen').fill('Wartungsfenster beachten')
  await dialog.getByLabel('Neuer Kommentar').fill('Termin steht.')
  await dialog.getByRole('button', { name: 'Senden' }).click()
  await expect(dialog.locator('.td-comments li')).toContainText('Termin steht.')
  await page.screenshot({ path: path.join(shots, 'aufgaben-details.png') })
  await dialog.getByRole('button', { name: 'Fertig' }).click()
  await expect(dialog).toHaveCount(0)

  // Die Karte zeigt alles auf einen Blick
  const patch = card(page, 'Server patchen')
  await expect(patch.locator('.prio-icon.urgent')).toBeVisible()
  await expect(patch.locator('.label-chip')).toHaveText('Server')
  await expect(patch.locator('.task-badge', { hasText: '1/2' })).toBeVisible()
  await expect(patch.locator('.due-chip')).toContainText('15.01.2030')
  await expect(patch.locator('.task-article')).toContainText('SRV-SQL01')
  await expect(patch.locator('.avatar')).toHaveText('BE')

  let board = readBoard()
  const [todoId, weekId] = board.buckets.map((b) => b.id)
  expect(board.tasks.find((t) => t.title === 'Server patchen')).toMatchObject({
    priority: 'urgent',
    dueDate: '2030-01-15',
    assignees: ['Ben'],
    articleId: server,
    notes: 'Wartungsfenster beachten',
    commentCount: 1,
    createdBy: 'admin'
  })

  // In den anderen Bucket ziehen
  await patch.dragTo(column(page, 'Diese Woche').locator('.col-body'))
  await expect(column(page, 'Diese Woche').locator('.task-title')).toHaveText(['Server patchen'])
  await expect.poll(() => readBoard().tasks.find((t) => t.title === 'Server patchen')?.bucketId).toBe(weekId)

  // Abhaken: wandert unten in „Erledigt“
  await card(page, 'Backup prüfen').getByRole('button', { name: 'Als erledigt markieren' }).click()
  await expect(todo.locator('.done-toggle')).toContainText('1')
  await expect(card(page, 'Backup prüfen')).toHaveCount(0)
  await todo.locator('.done-toggle').click()
  await expect(card(page, 'Backup prüfen')).toHaveClass(/\bdone\b/)

  // Nach Fortschritt gruppieren und in „In Bearbeitung“ ziehen
  await page.getByRole('button', { name: /Gruppieren nach/ }).click()
  await page.getByRole('menuitemradio', { name: 'Fortschritt' }).click()
  await expect(column(page, 'Erledigt').locator('.task-title')).toHaveText(['Backup prüfen'])
  await card(page, 'Backup prüfen').dragTo(column(page, 'In Bearbeitung').locator('.col-body'))
  await expect(column(page, 'In Bearbeitung').locator('.task-title')).toHaveText(['Backup prüfen'])
  await expect.poll(() => readBoard().tasks.find((t) => t.title === 'Backup prüfen')?.progress).toBe('active')

  // Nach Person gruppieren: von Ben zu admin ziehen
  await page.getByRole('button', { name: /Gruppieren nach/ }).click()
  await page.getByRole('menuitemradio', { name: 'Zugewiesen an' }).click()
  await card(page, 'Server patchen').dragTo(column(page, 'admin').locator('.col-body'))
  await expect(column(page, 'admin').locator('.task-title')).toHaveText(['Server patchen'])
  await expect.poll(() => readBoard().tasks.find((t) => t.title === 'Server patchen')?.assignees).toEqual(['admin'])

  // Filter
  await page.getByRole('button', { name: 'Mir zugewiesen' }).click()
  await expect(page.locator('.task-card .task-title')).toHaveText(['Server patchen'])
  await page.getByRole('button', { name: 'Mir zugewiesen' }).click()
  await page.getByLabel('Aufgaben filtern').fill('wartungsfenster')
  await expect(page.locator('.task-card .task-title')).toHaveText(['Server patchen'])
  await page.getByLabel('Aufgaben filtern').fill('')
  await page.getByRole('button', { name: /^Filter/ }).click()
  await page.locator('.filter-option', { hasText: 'Dringend' }).locator('input').check()
  await expect(page.locator('.task-card .task-title')).toHaveText(['Server patchen'])
  await page.getByRole('button', { name: 'Alle löschen' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.task-card')).toHaveCount(2)

  // Liste; ein anderer Rechner legt etwas an → erscheint von selbst
  await page.getByRole('tab', { name: 'Liste' }).click()
  await expect(page.locator('.task-list tbody tr')).toHaveCount(2)
  const other = new WikiStore(openDatabase(dbFile, 'Team'), 'Ben')
  other.tasks.createTask(todoId, 'Von Ben angelegt')
  other.db.close()
  await expect(page.locator('.task-list tbody tr', { hasText: 'Von Ben angelegt' })).toBeVisible()
  await page.getByRole('tab', { name: 'Board' }).click()

  // Der Artikel auf der Karte führt in die Mind Map; dort steht die Aufgabe im Artikel
  await page.getByRole('button', { name: /Gruppieren nach/ }).click()
  await page.getByRole('menuitemradio', { name: 'Bucket' }).click()
  await card(page, 'Server patchen').locator('.task-article').click()
  await expect(page.locator('.tasks-view')).toHaveCount(0)
  await expect(page.locator('.panel .article-title')).toHaveValue('SRV-SQL01')
  await expect(page.locator('.article-task-list li')).toContainText('Server patchen')
  // Neue Aufgabe direkt aus dem Artikel
  await page.getByLabel('Neue Aufgabe zu diesem Artikel').fill('Index neu aufbauen')
  await page.keyboard.press('Enter')
  await expect(page.locator('.article-task-list li')).toHaveCount(2)
  await page.locator('.article-task-list li', { hasText: 'Index neu aufbauen' }).click()
  await expect(dialog.locator('.td-title')).toHaveValue('Index neu aufbauen')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  // admin hat jetzt eine offene Aufgabe
  await expect(page.locator('.tab-count')).toHaveText('1')
  await app.close()

  // Neustart: alles noch da, Start in der Mind Map
  ;({ app, page } = await launch(workDir, 'Team.db', {}, { username: 'Ben', password: 'demo' }))
  running = app
  await expect(page.locator('.tasks-view')).toHaveCount(0)
  await expect(page.locator('.tab-count')).toHaveCount(0)
  await page.keyboard.press('Control+2')
  await expect(page.locator('.tasks-view')).toBeVisible()
  await expect(column(page, 'Zu erledigen').locator('.task-title')).toHaveText([
    'Index neu aufbauen',
    'Von Ben angelegt',
    'Backup prüfen'
  ])

  // Bucket mit allen Aufgaben löschen (nach Nachfrage)
  await column(page, 'Diese Woche').getByRole('button', { name: 'Bucket-Aktionen' }).click()
  await page.getByRole('button', { name: 'Bucket löschen' }).click()
  await expect(page.locator('.modal')).toContainText('„Diese Woche“ und die Aufgabe darin')
  await page.locator('.modal').getByRole('button', { name: 'Löschen' }).click()
  await expect(column(page, 'Diese Woche')).toHaveCount(0)
  expect(readBoard().tasks.map((t) => t.title).sort()).toEqual(['Backup prüfen', 'Index neu aufbauen', 'Von Ben angelegt'])
  await expect(page.locator('.toast.error')).toHaveCount(0)
  await app.close()
  running = null
})

test('Beispiel-Aufgaben im Beispiel-Wiki (Bild für die Anleitung)', async () => {
  const sampleDir = makeWorkDir()
  try {
    const { app, page } = await launch(sampleDir, null, { MINDWIKI_DOCUMENTS: path.join(sampleDir, 'Dokumente') }, null)
    running = app
    await login(page, { username: 'Anna', password: 'demo' })
    // Anna hat drei offene Aufgaben, eine davon überfällig
    await expect(page.locator('.tab-count')).toHaveText('3')
    await expect(page.locator('.tab-count')).toHaveClass(/late/)
    await page.getByRole('button', { name: /^Aufgaben/ }).click()
    await expect(page.locator('.board-col')).toHaveCount(4)
    await expect(card(page, 'Laufwerk D:').locator('.task-preview-checklist li')).toHaveCount(5)
    await page.mouse.move(700, 820)
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(shots, 'aufgaben.png') })
    await app.close()
    running = null
  } finally {
    removeDir(sampleDir)
  }
})
