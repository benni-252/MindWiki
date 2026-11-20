import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, openDatabase } from '../src/main/db'
import { WikiError, WikiStore } from '../src/main/store'
import type { TaskBoard } from '../src/shared/types'
import {
  buildColumns,
  EMPTY_FILTER,
  initials,
  matchesFilter,
  moveInBoard,
  reassign,
  sortTasks,
  summarize
} from '../src/renderer/src/tasks/board'
import {
  addDays,
  dateFromKey,
  dueDropDate,
  dueKey,
  formatDue,
  formatWeekday,
  quickDueOptions
} from '../src/renderer/src/tasks/dates'

let store: WikiStore

const board = (): TaskBoard => store.tasks.getTaskBoard()
const task = (id: number) => board().tasks.find((t) => t.id === id)!
const titles = (bucketId: number) =>
  board()
    .tasks.filter((t) => t.bucketId === bucketId)
    .sort((a, b) => a.position - b.position)
    .map((t) => t.title)

beforeEach(() => {
  store = new WikiStore(openDatabase(':memory:', 'Team'), 'Anna')
  store.createUser('Anna', 'geheim', 'editor')
  store.createUser('Ben', 'geheim', 'author')
})

describe('Aufgaben in der Wiki-Datei', () => {
  it('legt ohne Bucket „Zu erledigen“ an und reiht neue Aufgaben oben ein', () => {
    expect(board()).toMatchObject({ buckets: [], tasks: [], labels: [] })
    const a = store.tasks.createTask(null, '  Server   patchen ')
    const b = store.tasks.createTask(null, 'Backup prüfen')
    const { buckets } = board()
    expect(buckets.map((x) => x.name)).toEqual(['Zu erledigen'])
    expect(titles(buckets[0].id)).toEqual(['Backup prüfen', 'Server patchen'])
    expect(task(a)).toMatchObject({ progress: 'open', priority: 'medium', createdBy: 'Anna', notes: '', assignees: [] })
    expect(task(b).bucketId).toBe(buckets[0].id)
    expect(() => store.tasks.createTask(null, '   ')).toThrow(WikiError)
    expect(() => store.tasks.createTask(999, 'x')).toThrow(/Bucket/)
  })

  it('übernimmt Startwerte beim Anlegen', () => {
    const id = store.tasks.createTask(null, 'Dringendes', { priority: 'urgent', dueDate: '2026-12-01', assignees: ['ben'] })
    expect(task(id)).toMatchObject({ priority: 'urgent', dueDate: '2026-12-01', assignees: ['Ben'] })
  })

  it('verschiebt Aufgaben zwischen und innerhalb von Buckets', () => {
    const todo = store.tasks.createBucket('Zu erledigen')
    const week = store.tasks.createBucket('Diese Woche')
    const a = store.tasks.createTask(todo, 'A')
    const b = store.tasks.createTask(todo, 'B')
    const c = store.tasks.createTask(todo, 'C')
    expect(titles(todo)).toEqual(['C', 'B', 'A'])

    store.tasks.moveTask(a, todo, c)
    expect(titles(todo)).toEqual(['A', 'C', 'B'])
    store.tasks.moveTask(a, week, null)
    expect(titles(todo)).toEqual(['C', 'B'])
    expect(titles(week)).toEqual(['A'])
    store.tasks.moveTask(b, week, a)
    expect(titles(week)).toEqual(['B', 'A'])
    // Unbekanntes „davor“ → ans Ende
    store.tasks.moveTask(c, week, 12345)
    expect(titles(week)).toEqual(['B', 'A', 'C'])

    // Bucket im Detail ändern: oben im neuen Bucket
    store.tasks.updateTask(c, { bucketId: todo })
    expect(titles(todo)).toEqual(['C'])
    store.tasks.updateTask(a, { bucketId: todo })
    expect(titles(todo)).toEqual(['A', 'C'])

    // Optimistische Anzeige rechnet genauso
    const before = board()
    const predicted = moveInBoard(before, b, todo, c)
    store.tasks.moveTask(b, todo, c)
    const order = (x: TaskBoard) =>
      x.tasks
        .filter((t) => t.bucketId === todo)
        .sort((p, q) => p.position - q.position)
        .map((t) => t.title)
    expect(order(predicted)).toEqual(order(board()))
  })

  it('merkt sich, wer wann erledigt hat, und vergisst es beim Wiederöffnen', () => {
    const id = store.tasks.createTask(null, 'Toner bestellen')
    store.author = 'Ben'
    store.tasks.updateTask(id, { progress: 'done' })
    const done = task(id)
    expect(done.completedBy).toBe('Ben')
    expect(done.completedAt).toBeTruthy()
    // Nochmals „erledigt“ ändert nichts am Zeitpunkt
    store.author = 'Anna'
    store.tasks.updateTask(id, { progress: 'done', title: 'Toner bestellen (2 Stück)' })
    expect(task(id)).toMatchObject({ completedBy: 'Ben', completedAt: done.completedAt })
    store.tasks.updateTask(id, { progress: 'active' })
    expect(task(id)).toMatchObject({ progress: 'active', completedBy: null, completedAt: null })
  })

  it('prüft Felder', () => {
    const id = store.tasks.createTask(null, 'X')
    expect(() => store.tasks.updateTask(id, { priority: 'egal' as never })).toThrow(WikiError)
    expect(() => store.tasks.updateTask(id, { progress: 'fertig' as never })).toThrow(WikiError)
    expect(() => store.tasks.updateTask(id, { dueDate: '2026-02-30' })).toThrow(/Datum/)
    expect(() => store.tasks.updateTask(id, { title: 'x'.repeat(300) })).toThrow(/zu lang/)
    expect(() => store.tasks.updateTask(id, { preview: 'bild' as never })).toThrow(WikiError)
    store.tasks.updateTask(id, { startDate: '2026-11-20', dueDate: '2026-11-27', notes: 'Zeile 1\nZeile 2\n\n', preview: 'notes' })
    expect(task(id)).toMatchObject({ startDate: '2026-11-20', dueDate: '2026-11-27', notes: 'Zeile 1\nZeile 2', preview: 'notes' })
    store.tasks.updateTask(id, { dueDate: '', startDate: null })
    expect(task(id)).toMatchObject({ startDate: null, dueDate: null })
    expect(() => store.tasks.updateTask(4711, { title: 'weg' })).toThrow(/gibt es nicht mehr/)
  })

  it('weist nur vorhandene Benutzer zu; gelöschte bleiben, kommen aber nicht neu dazu', () => {
    const id = store.tasks.createTask(null, 'Zuweisen')
    store.tasks.setTaskAssignees(id, ['ben', 'Anna', 'BEN'])
    expect(task(id).assignees).toEqual(['Anna', 'Ben'])
    expect(() => store.tasks.setTaskAssignees(id, ['Carla'])).toThrow(/gibt es nicht/)

    const ben = store.listUsers().find((u) => u.username === 'Ben')!
    store.deleteUser(ben.id)
    expect(board().users).toContainEqual({ username: 'Ben', deleted: true })
    store.tasks.setTaskAssignees(id, ['Ben'])
    expect(task(id).assignees).toEqual(['Ben'])
    store.tasks.setTaskAssignees(id, [])
    expect(() => store.tasks.setTaskAssignees(id, ['Ben'])).toThrow(/gelöscht/)
  })

  it('verwaltet Bezeichnungen für alle Aufgaben', () => {
    const id = store.tasks.createTask(null, 'Firewall')
    const net = store.tasks.createTaskLabel('Netzwerk', 'teal')
    const sec = store.tasks.createTaskLabel('Sicherheit', 'red')
    expect(() => store.tasks.createTaskLabel('netzwerk', 'blue')).toThrow(/gibt es schon/)
    expect(() => store.tasks.createTaskLabel('Neu', 'türkis')).toThrow(/Farbe/)
    store.tasks.setTaskLabels(id, [sec, net, sec])
    expect(task(id).labelIds).toEqual([net, sec])
    store.tasks.updateTaskLabel(net, 'LAN', 'blue')
    expect(board().labels[0]).toMatchObject({ name: 'LAN', color: 'blue' })
    store.tasks.deleteTaskLabel(sec)
    expect(task(id).labelIds).toEqual([net])
    expect(() => store.tasks.setTaskLabels(id, [sec])).toThrow(WikiError)
  })

  it('hat eine Checkliste mit Reihenfolge', () => {
    const id = store.tasks.createTask(null, 'Arbeitsplatz')
    const a = store.tasks.addTaskCheckItem(id, 'Notebook')
    const b = store.tasks.addTaskCheckItem(id, 'Monitor')
    store.tasks.setTaskCheckItemChecked(a, true)
    store.tasks.moveTaskCheckItem(b, -1)
    store.tasks.updateTaskCheckItem(a, 'Notebook einrichten')
    expect(task(id).checklist.map((c) => [c.text, c.checked])).toEqual([
      ['Monitor', false],
      ['Notebook einrichten', true]
    ])
    store.tasks.deleteTaskCheckItem(b)
    expect(task(id).checklist).toHaveLength(1)
    expect(() => store.tasks.addTaskCheckItem(id, ' ')).toThrow(WikiError)
  })

  it('kennt Kommentare; löschen darf nur, wer sie geschrieben hat', () => {
    const id = store.tasks.createTask(null, 'Angebot')
    const first = store.tasks.addTaskComment(id, 'Angebot angefragt.')
    store.author = 'Ben'
    store.tasks.addTaskComment(id, '  Kommt morgen.\nGruß  ')
    const comments = store.tasks.getTaskComments(id)
    expect(comments.map((c) => [c.author, c.text])).toEqual([
      ['Ben', 'Kommt morgen.\nGruß'],
      ['Anna', 'Angebot angefragt.']
    ])
    expect(task(id).commentCount).toBe(2)
    expect(() => store.tasks.deleteTaskComment(first)).toThrow(/eigene/)
    store.author = 'anna'
    store.tasks.deleteTaskComment(first)
    expect(store.tasks.getTaskComments(id)).toHaveLength(1)
    expect(() => store.tasks.addTaskComment(id, '   ')).toThrow(WikiError)
  })

  it('kopiert Aufgaben direkt unter das Original – offen und ohne Kommentare', () => {
    const bucket = store.tasks.createBucket('Zu erledigen')
    const other = store.tasks.createTask(bucket, 'Andere')
    const id = store.tasks.createTask(bucket, 'Vorlage')
    const label = store.tasks.createTaskLabel('Server', 'blue')
    store.tasks.setTaskLabels(id, [label])
    store.tasks.setTaskAssignees(id, ['Ben'])
    store.tasks.setTaskCheckItemChecked(store.tasks.addTaskCheckItem(id, 'Schritt'), true)
    store.tasks.addTaskComment(id, 'Notiz')
    store.tasks.updateTask(id, { progress: 'done', priority: 'important', dueDate: '2026-12-24' })

    const copy = store.tasks.copyTask(id)
    expect(titles(bucket)).toEqual(['Vorlage', 'Kopie von Vorlage', 'Andere'])
    expect(task(copy)).toMatchObject({
      progress: 'open',
      priority: 'important',
      dueDate: '2026-12-24',
      assignees: ['Ben'],
      labelIds: [label],
      commentCount: 0,
      completedBy: null
    })
    expect(task(copy).checklist.map((c) => c.checked)).toEqual([false])
    expect(task(other).title).toBe('Andere')
  })

  it('löscht Buckets samt Aufgaben und ordnet Buckets um', () => {
    const a = store.tasks.createBucket('A')
    const b = store.tasks.createBucket('B')
    const c = store.tasks.createBucket('C')
    store.tasks.moveBucket(c, -1)
    store.tasks.renameBucket(a, 'Alles')
    expect(board().buckets.map((x) => x.name)).toEqual(['Alles', 'C', 'B'])
    const t = store.tasks.createTask(b, 'weg damit')
    store.tasks.addTaskCheckItem(t, 'auch weg')
    store.tasks.deleteBucket(b)
    expect(board().tasks).toHaveLength(0)
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM task_checklist').get()).toEqual({ n: 0 })
    expect(() => store.tasks.renameBucket(a, '  ')).toThrow(WikiError)
  })

  it('verknüpft Artikel: Papierkorb blendet den Titel aus, endgültig gelöscht fällt die Verknüpfung weg', () => {
    const article = store.createArticle(store.rootId(), 'SRV-SQL01')
    const id = store.tasks.createTask(null, 'Laufwerk vergrößern', { articleId: article })
    expect(task(id)).toMatchObject({ articleId: article, articleTitle: 'SRV-SQL01' })
    store.renameArticle(article, 'SRV-SQL02')
    expect(task(id).articleTitle).toBe('SRV-SQL02')
    store.deleteArticle(article)
    expect(task(id)).toMatchObject({ articleId: article, articleTitle: null })
    expect(() => store.tasks.updateTask(id, { articleId: article })).toThrow(/Artikel/)
    store.restoreArticle(article)
    expect(task(id).articleTitle).toBe('SRV-SQL02')
    store.deleteArticle(article)
    store.purgeArticle(article)
    expect(task(id)).toMatchObject({ articleId: null, articleTitle: null })
  })

  it('braucht keinen Versionssprung und bleibt in der Datei erhalten', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindwiki-tasks-'))
    const file = path.join(dir, 'Wiki.db')
    try {
      const first = new WikiStore(openDatabase(file, 'Team'), 'Anna')
      const id = first.tasks.createTask(null, 'Bleibt')
      first.db.close()
      const again = new WikiStore(openDatabase(file, 'Team'), 'Anna')
      expect(again.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length })
      expect(again.tasks.getTaskBoard().tasks.map((t) => [t.id, t.title])).toEqual([[id, 'Bleibt']])
      again.db.close()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Fälligkeit', () => {
  // Freitag, 20.11.2026
  const today = '2026-11-20'

  it('ordnet Tage den Spalten zu (Wochen von Montag bis Sonntag)', () => {
    expect(new Date(2026, 10, 20).getDay()).toBe(5) // Freitag
    expect(dueKey(null, today)).toBe('none')
    expect(dueKey('2026-11-19', today)).toBe('overdue')
    expect(dueKey(today, today)).toBe('today')
    expect(dueKey('2026-11-21', today)).toBe('tomorrow')
    expect(dueKey('2026-11-22', today)).toBe('week')
    expect(dueKey('2026-11-23', today)).toBe('nextweek')
    expect(dueKey('2026-11-29', today)).toBe('nextweek')
    expect(dueKey('2026-11-30', today)).toBe('later')
  })

  it('setzt beim Ziehen sinnvolle Tage', () => {
    // Freitag: „Diese Woche“ ist nur noch Sonntag
    expect(dueDropDate('week', today)).toBe('2026-11-22')
    expect(dueDropDate('nextweek', today)).toBe('2026-11-27')
    expect(dueDropDate('today', today)).toBe(today)
    expect(dueDropDate('none', today)).toBeNull()
    expect(dueDropDate('overdue', today)).toBeUndefined()
    expect(dueDropDate('later', today)).toBeUndefined()
    // Montag: Freitag derselben Woche
    expect(dueDropDate('week', '2026-11-16')).toBe('2026-11-20')
    // Samstag: Sonntag ist schon „Morgen“
    expect(dueDropDate('week', '2026-11-21')).toBeUndefined()
  })

  it('bietet im Kontextmenü passende Tage an', () => {
    const show = (day: string) => quickDueOptions(day).map((o) => `${o.label} ${formatWeekday(o.date)}`)
    // Freitag: „Diese Woche“ wäre Sonntag
    expect(show(today)).toEqual(['Heute Fr 20.11.', 'Morgen Sa 21.11.', 'Diese Woche So 22.11.', 'Nächste Woche Fr 27.11.'])
    // Montag: Freitag derselben Woche
    expect(show('2026-11-16')).toEqual(['Heute Mo 16.11.', 'Morgen Di 17.11.', 'Diese Woche Fr 20.11.', 'Nächste Woche Fr 27.11.'])
    // Samstag: diese Woche ist praktisch vorbei
    expect(show('2026-11-21')).toEqual(['Heute Sa 21.11.', 'Morgen So 22.11.', 'Nächste Woche Fr 27.11.'])
    // Über den Jahreswechsel
    expect(quickDueOptions('2026-12-31').map((o) => o.date)).toEqual(['2026-12-31', '2027-01-01', '2027-01-03', '2027-01-08'])
  })

  it('versteht Kürzel im Datumsfeld: h, m, n', () => {
    expect(dateFromKey('h', today)).toBe('2026-11-20')
    expect(dateFromKey('m', today)).toBe('2026-11-21')
    // Freitag nächste Woche – von Freitag, Sonntag und Montag aus
    expect(dateFromKey('n', today)).toBe('2026-11-27')
    expect(dateFromKey('n', '2026-11-22')).toBe('2026-11-27')
    expect(dateFromKey('n', '2026-11-23')).toBe('2026-12-04')
    // Großbuchstaben (Umschalt) ebenso, andere Tasten nicht
    expect(dateFromKey('M', '2026-12-31')).toBe('2027-01-01')
    expect(dateFromKey('x', today)).toBeNull()
    expect(dateFromKey('1', today)).toBeNull()
    expect(dateFromKey('Enter', today)).toBeNull()
  })

  it('zeigt Fälligkeiten kurz an', () => {
    expect(formatDue(today, today)).toBe('Heute')
    expect(formatDue(addDays(today, 1), today)).toBe('Morgen')
    expect(formatDue(addDays(today, -1), today)).toBe('Gestern')
    expect(formatDue('2026-11-25', today)).toBe('Mi 25.11.')
    expect(formatDue('2027-01-04', today)).toBe('04.01.2027')
  })
})

describe('Board', () => {
  const today = '2026-11-20'

  function sample(): TaskBoard {
    const todo = store.tasks.createBucket('Zu erledigen')
    const wait = store.tasks.createBucket('Warten')
    const net = store.tasks.createTaskLabel('Netzwerk', 'teal')
    const a = store.tasks.createTask(todo, 'Switch-Firmware', { priority: 'important', dueDate: '2026-11-19', assignees: ['Ben'] })
    store.tasks.setTaskLabels(a, [net])
    store.tasks.createTask(todo, 'Zertifikat erneuern', { priority: 'urgent', dueDate: today, assignees: ['Anna', 'Ben'] })
    const c = store.tasks.createTask(wait, 'Angebot NAS', { priority: 'low' })
    store.tasks.updateTask(c, { notes: 'Größe: 20 TB', progress: 'done' })
    store.tasks.createTask(wait, 'Drucker prüfen', { dueDate: '2026-12-10' })
    return board()
  }

  it('gruppiert nach Bucket, Fortschritt, Priorität, Zuweisung und Fälligkeit', () => {
    const b = sample()
    const cols = (g: Parameters<typeof buildColumns>[2]) =>
      buildColumns(b, b.tasks, g, today).map((c) => [c.title, c.tasks.map((t) => t.title), c.completed.map((t) => t.title)])

    expect(cols('bucket')).toEqual([
      ['Zu erledigen', ['Zertifikat erneuern', 'Switch-Firmware'], []],
      ['Warten', ['Drucker prüfen'], ['Angebot NAS']]
    ])
    expect(cols('progress')).toEqual([
      ['Nicht begonnen', ['Zertifikat erneuern', 'Switch-Firmware', 'Drucker prüfen'], []],
      ['In Bearbeitung', [], []],
      ['Erledigt', ['Angebot NAS'], []]
    ])
    expect(cols('priority').map((c) => [c[0], c[1]])).toEqual([
      ['Dringend', ['Zertifikat erneuern']],
      ['Wichtig', ['Switch-Firmware']],
      ['Mittel', ['Drucker prüfen']],
      ['Niedrig', []]
    ])
    expect(cols('assignee').map((c) => [c[0], c[1]])).toEqual([
      ['Nicht zugewiesen', ['Drucker prüfen']],
      ['admin', []],
      ['Anna', ['Zertifikat erneuern']],
      ['Ben', ['Zertifikat erneuern', 'Switch-Firmware']]
    ])
    const due = buildColumns(b, b.tasks, 'due', today)
    expect(due.map((c) => [c.title, c.tasks.length + c.completed.length])).toEqual([
      ['Überfällig', 1],
      ['Heute', 1],
      ['Morgen', 0],
      ['Diese Woche', 0],
      ['Nächste Woche', 0],
      ['Später', 1],
      ['Kein Datum', 1]
    ])
    expect(due[0].drop).toBeNull()
    expect(due[1].drop).toEqual({ kind: 'due', date: today })
    expect(due[1].add).toEqual({ bucketId: null, dueDate: today })
  })

  it('filtert nach Text, „Mir zugewiesen“, Fälligkeit, Priorität und Bezeichnung', () => {
    const b = sample()
    const run = (f: Partial<typeof EMPTY_FILTER>, me = 'Anna') =>
      b.tasks.filter((t) => matchesFilter(t, { ...EMPTY_FILTER, ...f }, b, me, today)).map((t) => t.title).sort()

    expect(run({ text: 'GROSSE' })).toEqual(['Angebot NAS'])
    expect(run({ text: 'netzwerk switch' })).toEqual(['Switch-Firmware'])
    expect(run({ mine: true })).toEqual(['Zertifikat erneuern'])
    expect(run({ mine: true }, 'ben')).toEqual(['Switch-Firmware', 'Zertifikat erneuern'])
    expect(run({ due: ['overdue'] })).toEqual(['Switch-Firmware'])
    expect(run({ due: ['none'] })).toEqual(['Angebot NAS'])
    expect(run({ priority: ['urgent', 'low'] })).toEqual(['Angebot NAS', 'Zertifikat erneuern'])
    expect(run({ labels: [b.labels[0].id] })).toEqual(['Switch-Firmware'])
    expect(run({ assignees: [''] })).toEqual(['Angebot NAS', 'Drucker prüfen'])
    expect(summarize(b.tasks, today)).toEqual({ total: 4, open: 3, active: 0, done: 1, overdue: 1 })
  })

  it('sortiert die Liste, erledigte immer unten', () => {
    const b = sample()
    expect(sortTasks(b.tasks, b, 'due', false).map((t) => t.title)).toEqual([
      'Switch-Firmware',
      'Zertifikat erneuern',
      'Drucker prüfen',
      'Angebot NAS'
    ])
    expect(sortTasks(b.tasks, b, 'priority', true).map((t) => t.title)).toEqual([
      'Drucker prüfen',
      'Switch-Firmware',
      'Zertifikat erneuern',
      'Angebot NAS'
    ])
  })

  it('ändert Zuweisungen beim Ziehen zwischen Personen', () => {
    expect(reassign(['Anna', 'Ben'], 'ben', 'Carla')).toEqual(['Anna', 'Carla'])
    expect(reassign([], null, 'Ben')).toEqual(['Ben'])
    expect(reassign(['Ben'], 'Ben', null)).toEqual([])
    expect(reassign(['Anna', 'Ben'], 'Anna', 'Ben')).toEqual(['Ben'])
    expect(initials('anna.schmidt')).toBe('AS')
    expect(initials('Ben')).toBe('BE')
  })
})
