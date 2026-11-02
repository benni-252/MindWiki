import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { docText } from '../src/main/links'
import { WikiError, WikiStore } from '../src/main/store'
import { diffLines } from '../src/shared/diff'

const textDoc = (text: string): string =>
  JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

let anna: WikiStore
let root: number

/** Wechselt die Person am selben Wiki (wie ein zweiter Rechner an derselben Datei). */
function as<T>(name: string, fn: () => T): T {
  const before = anna.author
  anna.author = name
  try {
    return fn()
  } finally {
    anna.author = before
  }
}

const summary = (id: number) => anna.getTree().articles.find((a) => a.id === id)

beforeEach(() => {
  anna = new WikiStore(openDatabase(':memory:', 'Team'), 'Anna')
  root = anna.rootId()
})

describe('Freigabe ausgeschaltet (Standard)', () => {
  it('lässt alles wie bisher direkt ändern', () => {
    expect(anna.getTree().approvalRequired).toBe(false)
    const a = anna.createArticle(root, 'Server')
    expect(summary(a)).toMatchObject({ approved: true, createdBy: 'Anna', draftId: null })
    as('Ben', () => anna.renameArticle(a, 'Server 2'))
    expect(summary(a)?.title).toBe('Server 2')
  })
})

describe('Freigabe-Pflicht', () => {
  beforeEach(() => anna.setApprovalRequired(true))

  it('macht neue Artikel zu Entwürfen, die nur jemand anderes freigeben kann', () => {
    const a = anna.createArticle(root, 'Neuer Drucker')
    expect(summary(a)).toMatchObject({ approved: false, createdBy: 'Anna' })
    // Die Autorin darf ihren Entwurf weiter bearbeiten …
    anna.saveArticleContent(a, textDoc('Steht im Flur'), 'Steht im Flur')
    anna.addField(a, 'IP-Adresse', '10.0.0.7')
    // … aber nicht selbst freigeben, und andere dürfen ihn nicht ändern
    expect(() => anna.approve(a)).toThrow(WikiError)
    expect(() => as('Ben', () => anna.renameArticle(a, 'Mein Drucker'))).toThrow(/Entwurf von Anna/)
    as('Ben', () => anna.approve(a))
    expect(summary(a)?.approved).toBe(true)
    expect(anna.getChanges(a)[0]).toMatchObject({ author: 'Ben', kind: 'approval', summary: 'Neuen Artikel von Anna freigegeben' })
  })

  it('legt Änderungen an freigegebenen Artikeln als Entwurf ab, bis jemand anderes freigibt', () => {
    const srv = anna.createArticle(root, 'SRV-01')
    anna.saveArticleContent(srv, textDoc('Alter Text'), 'Alter Text')
    const ip = anna.addField(srv, 'IP-Adresse', '10.0.0.1')
    anna.addField(srv, 'Passwort', 'geheim')
    const list = anna.createChecklist(srv, 'Neustart')
    anna.addItem(list, 'Dienste stoppen')
    anna.completeRun(list, null)
    as('Ben', () => anna.approve(srv))

    // Direktes Ändern ist nicht mehr möglich
    expect(() => anna.updateField(ip, 'IP-Adresse', '10.0.0.2')).toThrow(/Bearbeiten/)
    expect(() => anna.addItem(list, 'Neustart')).toThrow(/Bearbeiten/)

    // Umbenennen in der Mind Map legt automatisch den Entwurf an
    anna.renameArticle(srv, 'SRV-01 (neu)')
    const draft = summary(srv)!.draftId!
    expect(summary(srv)).toMatchObject({ title: 'SRV-01 (neu)', draftBy: 'Anna' })
    expect(as('Ben', () => summary(srv))).toMatchObject({ title: 'SRV-01', draftBy: 'Anna' })
    expect(anna.startDraft(srv)).toBe(draft)

    // Im Entwurf arbeitet man mit dessen Feldern und Abläufen
    anna.saveArticleContent(draft, textDoc('Neuer Text'), 'Neuer Text')
    const draftIp = anna.getFields(draft).find((f) => f.label === 'IP-Adresse')!
    anna.updateField(draftIp.id, 'IP-Adresse', '10.0.0.2')
    const draftPw = anna.getFields(draft).find((f) => f.label === 'Passwort')!
    anna.updateField(draftPw.id, 'Passwort', 'noch geheimer')
    const draftList = anna.getChecklists(draft)[0]
    anna.addItem(draftList.id, 'Neustart')

    // Original unverändert, für alle anderen
    expect(docText(anna.getArticle(srv)!.content)).toBe('Alter Text')
    expect(anna.getFields(srv).find((f) => f.label === 'IP-Adresse')?.value).toBe('10.0.0.1')
    expect(anna.search('Neuer Text')).toEqual([])
    expect(anna.getTree().articles.some((a) => a.id === draft)).toBe(false)

    // Ben kann keinen zweiten Entwurf anfangen, aber vergleichen
    expect(() => as('Ben', () => anna.startDraft(srv))).toThrow(/Anna hat bereits Änderungen/)
    const diff = as('Ben', () => anna.getDraftDiff(srv))!
    expect(diff).toMatchObject({
      author: 'Anna',
      title: { before: 'SRV-01', after: 'SRV-01 (neu)' },
      text: { before: 'Alter Text', after: 'Neuer Text' }
    })
    expect(diff.fields).toEqual([
      { label: 'IP-Adresse', before: '10.0.0.1', after: '10.0.0.2' },
      { label: 'Passwort', before: '••••••', after: '••••••' }
    ])
    expect(diff.checklists).toEqual([{ title: 'Neustart', change: 'changed', detail: ['+ Neustart'] }])
    expect(() => anna.approve(srv)).toThrow(/jemand anderes/)

    // Freigabe überträgt alles, behält das Ablauf-Protokoll und zeigt die Schritte im Verlauf
    as('Ben', () => anna.approve(srv))
    expect(summary(srv)).toMatchObject({ title: 'SRV-01 (neu)', draftId: null })
    expect(docText(anna.getArticle(srv)!.content)).toBe('Neuer Text')
    expect(anna.getFields(srv).map((f) => [f.label, f.value])).toEqual([
      ['IP-Adresse', '10.0.0.2'],
      ['Passwort', 'noch geheimer']
    ])
    const lists = anna.getChecklists(srv)
    expect(lists).toHaveLength(1)
    expect(lists[0].id).toBe(list)
    expect(lists[0].items.map((i) => i.text)).toEqual(['Dienste stoppen', 'Neustart'])
    expect(anna.getRuns(list)).toHaveLength(1)
    expect(anna.getArticle(draft)).toBeNull()
    const history = anna.getChanges(srv).map((c) => `${c.author}: ${c.summary}`)
    expect(history[0]).toBe('Ben: Änderungen von Anna freigegeben')
    expect(history).toContain('Anna: Titel geändert: „SRV-01“ → „SRV-01 (neu)“')
    expect(history).toContain('Anna: IP-Adresse: „10.0.0.1“ → „10.0.0.2“')
  })

  it('verwirft abgelehnte Änderungen, hebt den Text aber im Verlauf auf', () => {
    const a = anna.createArticle(root, 'Anleitung')
    as('Ben', () => anna.approve(a))
    const draft = anna.startDraft(a)
    anna.saveArticleContent(draft, textDoc('Falsch'), 'Falsch')
    as('Ben', () => anna.reject(a, 'Bitte mit Screenshots'))
    expect(summary(a)?.draftId).toBeNull()
    expect(anna.getArticle(draft)).toBeNull()
    const entry = anna.getChanges(a)[0]
    expect(entry).toMatchObject({ author: 'Ben', summary: 'Änderungen von Anna abgelehnt: „Bitte mit Screenshots“', hasVersion: true })
    expect(docText(anna.getTextVersion(entry.id))).toBe('Falsch')
  })

  it('legt abgelehnte neue Artikel in den Papierkorb', () => {
    const a = as('Ben', () => anna.createArticle(root, 'Doppelt'))
    anna.reject(a, null)
    expect(summary(a)).toBeUndefined()
    expect(anna.listTrash().map((t) => t.title)).toEqual(['Doppelt'])
  })

  it('lässt die Autorin ihren Entwurf verwerfen, nicht aber andere', () => {
    const a = anna.createArticle(root, 'A')
    as('Ben', () => anna.approve(a))
    anna.startDraft(a)
    expect(() => as('Ben', () => anna.discardDraft(a))).toThrow(WikiError)
    anna.discardDraft(a)
    expect(summary(a)?.draftId).toBeNull()
  })

  it('lässt Störungen, Abhängigkeiten und Abhaken ohne Freigabe zu', () => {
    const a = anna.createArticle(root, 'Switch')
    const b = anna.createArticle(root, 'Server')
    const list = anna.createChecklist(a, 'Prüfen')
    const step = anna.addItem(list, 'Ping')
    as('Ben', () => {
      anna.approve(a)
      anna.approve(b)
      anna.reportOutage(a, 'aus')
      anna.addDependency(b, a)
      anna.setItemChecked(step, true)
    })
    expect(summary(a)?.outageSince).not.toBeNull()
    expect(anna.getTree().dependencies).toHaveLength(1)
  })

  it('stellt alte Fassungen über einen Entwurf wieder her', () => {
    const a = anna.createArticle(root, 'Text')
    anna.saveArticleContent(a, textDoc('Eins'), 'Eins')
    as('Ben', () => anna.approve(a))
    const draft = anna.startDraft(a)
    anna.saveArticleContent(draft, textDoc('Zwei'), 'Zwei')
    as('Ben', () => anna.approve(a))
    const version = anna.getChanges(a).find((c) => c.kind === 'text' && c.hasVersion)!
    expect(docText(anna.getTextVersion(version.id))).toBe('Eins')
    anna.restoreTextVersion(version.id)
    expect(docText(anna.getArticle(a)!.content)).toBe('Zwei')
    expect(docText(anna.getArticle(summary(a)!.draftId!)!.content)).toBe('Eins')
  })

  it('übernimmt beim Ausschalten alle offenen Entwürfe', () => {
    const neu = as('Ben', () => anna.createArticle(root, 'Neu'))
    const alt = anna.createArticle(root, 'Alt')
    as('Ben', () => anna.approve(alt))
    anna.renameArticle(alt, 'Alt geändert')
    anna.setApprovalRequired(false)
    expect(summary(neu)?.approved).toBe(true)
    expect(summary(alt)).toMatchObject({ title: 'Alt geändert', draftId: null })
    expect(anna.getChanges(root)[0].summary).toBe('Freigabe-Pflicht ausgeschaltet')
  })

  it('nimmt Entwürfe mit in den Papierkorb und wieder heraus', () => {
    const a = anna.createArticle(root, 'Ast')
    as('Ben', () => anna.approve(a))
    anna.renameArticle(a, 'Ast neu')
    anna.deleteArticle(a)
    expect(anna.listTrash()).toEqual([expect.objectContaining({ title: 'Ast', count: 1 })])
    anna.restoreArticle(a)
    expect(summary(a)).toMatchObject({ title: 'Ast neu', draftBy: 'Anna' })
  })
})

describe('diffLines', () => {
  it('findet hinzugefügte und entfernte Zeilen', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'c', 'd'])).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' }
    ])
    expect(diffLines([], ['x'])).toEqual([{ kind: 'added', text: 'x' }])
  })
})
