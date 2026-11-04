import { beforeEach, describe, expect, it } from 'vitest'
import { cleanAttachmentName, formatBytes, isBlockedAttachment, MAX_ATTACHMENT_BYTES, mimeOf } from '../src/shared/attachments'
import { openDatabase } from '../src/main/db'
import { WikiError, WikiStore } from '../src/main/store'

let store: WikiStore
let root: number

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const fileCount = (): number => (store.db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }).n
const summary = (id: number) => store.getTree().articles.find((a) => a.id === id)!

/** Wechselt die Person am selben Wiki (wie ein zweiter Rechner an derselben Datei). */
function as<T>(name: string, fn: () => T): T {
  const before = store.author
  store.author = name
  try {
    return fn()
  } finally {
    store.author = before
  }
}

beforeEach(() => {
  store = new WikiStore(openDatabase(':memory:', 'Team'), 'Anna')
  root = store.rootId()
})

describe('Anhänge', () => {
  it('hängt Dokumente an, liefert sie wieder und protokolliert das im Verlauf', () => {
    const srv = store.createArticle(root, 'SRV-01')
    const id = store.addAttachment(srv, 'C:\\Users\\anna\\Handbuch.pdf', bytes('%PDF-1.7 Handbuch'))
    store.addAttachment(srv, 'Netzplan.vsdx', bytes('visio'))

    expect(store.getAttachments(srv)).toMatchObject([
      { id, name: 'Handbuch.pdf', mime: 'application/pdf', size: 17, addedBy: 'Anna' },
      { name: 'Netzplan.vsdx' }
    ])
    const file = store.getAttachmentFile(id)!
    expect(new TextDecoder().decode(file.data)).toBe('%PDF-1.7 Handbuch')
    expect(summary(srv).attachmentCount).toBe(2)
    expect(store.getChanges(srv)[0]).toMatchObject({ kind: 'attachment', summary: 'Anhang „Netzplan.vsdx“ hinzugefügt (5 Byte)' })

    as('Ben', () => store.deleteAttachment(id))
    expect(store.getAttachments(srv).map((a) => a.name)).toEqual(['Netzplan.vsdx'])
    expect(store.getChanges(srv)[0]).toMatchObject({ author: 'Ben', summary: 'Anhang „Handbuch.pdf“ entfernt' })
    // Der Inhalt wird mit entfernt
    expect(fileCount()).toBe(1)
  })

  it('benennt doppelte Namen um und lehnt Programme, leere und zu große Dateien ab', () => {
    const a = store.createArticle(root, 'A')
    store.addAttachment(a, 'Bericht.docx', bytes('1'))
    store.addAttachment(a, 'bericht.docx', bytes('2'))
    store.addAttachment(a, 'Bericht.docx', bytes('3'))
    expect(store.getAttachments(a).map((x) => x.name)).toEqual(['Bericht.docx', 'bericht (2).docx', 'Bericht (3).docx'])

    expect(() => store.addAttachment(a, 'Rechnung.pdf.exe', bytes('MZ'))).toThrow(/Programme und Skripte/)
    expect(() => store.addAttachment(a, 'setup.EXE. ', bytes('MZ'))).toThrow(/Programme und Skripte/)
    expect(() => store.addAttachment(a, 'leer.txt', new Uint8Array())).toThrow(/leer/)
    expect(() => store.addAttachment(a, 'riesig.zip', new Uint8Array(MAX_ATTACHMENT_BYTES + 1))).toThrow(/zu groß \(50 MB\)/)
    expect(store.getAttachments(a)).toHaveLength(3)
  })

  it('räumt Inhalte erst beim endgültigen Löschen aus dem Papierkorb auf', () => {
    const a = store.createArticle(root, 'Ast')
    store.addAttachment(a, 'a.txt', bytes('a'))
    store.deleteArticle(a)
    expect(fileCount()).toBe(1)
    store.restoreArticle(a)
    expect(store.getAttachments(a)).toHaveLength(1)
    store.deleteArticle(a)
    store.purgeArticle(a)
    expect(fileCount()).toBe(0)
  })

  it('nimmt Anhänge in den PDF-Export auf', () => {
    const a = store.createArticle(root, 'A')
    store.addAttachment(a, 'Plan.pdf', new Uint8Array(1536))
    expect(store.exportArticle(a).attachments).toEqual([{ name: 'Plan.pdf', size: '1,5 KB' }])
  })
})

describe('Anhänge mit Freigabe-Pflicht', () => {
  beforeEach(() => store.setApprovalRequired(true))

  it('ändert Anhänge freigegebener Artikel nur über einen Entwurf', () => {
    const srv = store.createArticle(root, 'SRV-01')
    const manual = store.addAttachment(srv, 'Handbuch.pdf', bytes('alt'))
    as('Ben', () => store.approve(srv))
    expect(() => store.addAttachment(srv, 'Neu.pdf', bytes('neu'))).toThrow(/Bearbeiten/)
    expect(() => store.deleteAttachment(manual)).toThrow(WikiError)

    // Entwurf: Anhänge werden übernommen (ohne den Inhalt zu kopieren)
    const draft = store.startDraft(srv)
    expect(store.getAttachments(draft).map((x) => x.name)).toEqual(['Handbuch.pdf'])
    expect(fileCount()).toBe(1)
    store.addAttachment(draft, 'Neu.pdf', bytes('neu'))
    store.deleteAttachment(store.getAttachments(draft).find((x) => x.name === 'Handbuch.pdf')!.id)

    // Die anderen sehen bis zur Freigabe die alten Anhänge
    expect(store.getAttachments(srv).map((x) => x.name)).toEqual(['Handbuch.pdf'])
    expect(summary(srv).attachmentCount).toBe(1)
    expect(as('Ben', () => store.getDraftDiff(srv))?.attachments).toEqual([
      { name: 'Neu.pdf', change: 'added' },
      { name: 'Handbuch.pdf', change: 'removed' }
    ])

    as('Ben', () => store.approve(srv))
    expect(store.getAttachments(srv).map((x) => x.name)).toEqual(['Neu.pdf'])
    expect(new TextDecoder().decode(store.getAttachmentFile(store.getAttachments(srv)[0].id)!.data)).toBe('neu')
    expect(fileCount()).toBe(1)
    expect(store.getChanges(srv).map((c) => c.summary)).toContain('Anhang „Neu.pdf“ hinzugefügt (3 Byte)')
  })

  it('verwirft Anhänge abgelehnter Entwürfe', () => {
    const a = store.createArticle(root, 'A')
    store.addAttachment(a, 'bleibt.txt', bytes('bleibt'))
    as('Ben', () => store.approve(a))
    const draft = store.startDraft(a)
    store.addAttachment(draft, 'weg.txt', bytes('weg'))
    expect(fileCount()).toBe(2)
    as('Ben', () => store.reject(a, null))
    expect(store.getAttachments(a).map((x) => x.name)).toEqual(['bleibt.txt'])
    expect(fileCount()).toBe(1)
  })
})

describe('Regeln für Dateinamen', () => {
  it('erkennt gefährliche Typen, bereinigt Namen und formatiert Größen', () => {
    expect(isBlockedAttachment('x.ps1')).toBe(true)
    expect(isBlockedAttachment('verknüpfung.LNK')).toBe(true)
    expect(isBlockedAttachment('bericht.pdf')).toBe(false)
    expect(isBlockedAttachment('ohne-endung')).toBe(false)
    expect(cleanAttachmentName('../../etc/a:b?.txt')).toBe('a_b_.txt')
    expect(cleanAttachmentName('   ')).toBe('Anhang')
    expect(cleanAttachmentName(`${'x'.repeat(300)}.pdf`)).toMatch(/^x{146}\.pdf$/)
    expect(mimeOf('Liste.XLSX')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(formatBytes(512)).toBe('512 Byte')
    expect(formatBytes(1536)).toBe('1,5 KB')
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB')
  })
})
