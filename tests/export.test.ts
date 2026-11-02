import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { articleToHtml, renderContent } from '../src/main/exportHtml'
import { WikiStore } from '../src/main/store'

const ctx = {
  articleTitle: (id: number) => (id === 7 ? 'SQL-Server (neu)' : undefined),
  imageSrc: (src: string) => (src === 'wikiimg://img/3' ? 'data:image/png;base64,AAA' : undefined)
}

describe('HTML für den PDF-Export', () => {
  it('übersetzt das TipTap-Dokument', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Überblick' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'fett', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' <script>' },
            { type: 'text', text: 'Link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
            { type: 'text', text: 'böse', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
            { type: 'articleLink', attrs: { id: 7, label: 'SQL-Server' } }
          ]
        },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Punkt' }] }] }] },
        { type: 'image', attrs: { src: 'wikiimg://img/3' } },
        { type: 'image', attrs: { src: 'https://fremd.example/bild.png' } },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Netz' }] }] }] },
            { type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '10.0.0.0/24' }] }] }] }
          ]
        }
      ]
    })
    const html = renderContent(doc, ctx)
    expect(html).toContain('<h3>Überblick</h3>')
    expect(html).toContain('<strong>fett</strong>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<a href="https://example.com">Link</a>')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('<span class="article-link">SQL-Server (neu)</span>')
    expect(html).toContain('<ul><li><p>Punkt</p></li></ul>')
    expect(html).toContain('<img src="data:image/png;base64,AAA"')
    expect(html).not.toContain('fremd.example')
    expect(html).toContain('<th><p>Netz</p></th>')
    expect(html).toContain('<td colspan="2">')
    expect(renderContent('kaputt', ctx)).toBe('')
  })

  it('baut die ganze Seite mit Steckbrief, Abläufen und Abhängigkeiten', () => {
    const html = articleToHtml(
      {
        title: 'SRV <01>',
        path: ['IT', 'Server'],
        content: null,
        fields: [{ label: 'IP-Adresse', value: '10.0.0.1' }],
        checklists: [{ title: 'Neustart', steps: ['Dienste stoppen'], lastRun: '01.11.2026 10:00' }],
        dependsOn: ['Switch'],
        neededBy: [],
        notes: [{ kind: 'danger', text: 'Störung seit heute' }],
        meta: 'Zuletzt geändert …'
      },
      ctx
    )
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<h1>SRV &lt;01&gt;</h1>')
    expect(html).toContain('IT › Server')
    expect(html).toContain('<div class="note danger">Störung seit heute</div>')
    expect(html).toContain('<td>IP-Adresse</td><td>10.0.0.1</td>')
    expect(html).toContain('Dienste stoppen')
    expect(html).toContain('Zuletzt durchgeführt: 01.11.2026 10:00')
    expect(html).toContain('<h3>Hängt ab von</h3><ul><li>Switch</li></ul>')
  })
})

describe('Exportdaten aus dem Wiki', () => {
  it('sammelt Pfad, Felder (ohne Passwörter), Abläufe, Abhängigkeiten und Hinweise', () => {
    const store = new WikiStore(openDatabase(':memory:', 'IT'), 'Anna')
    const root = store.rootId()
    const servers = store.createArticle(root, 'Server')
    const sql = store.createArticle(servers, 'SQL')
    const app = store.createArticle(servers, 'App')
    store.addField(sql, 'IP-Adresse', '10.0.0.20')
    store.addField(sql, 'Passwort', 'geheim')
    store.addField(sql, 'Leer')
    const list = store.createChecklist(sql, 'Neustart')
    store.addItem(list, 'Dienst stoppen')
    store.completeRun(list, 'alles gut')
    store.addDependency(app, sql)
    store.reportOutage(sql, 'Platte voll')

    const data = store.exportArticle(sql)
    expect(data.path).toEqual(['IT', 'Server'])
    expect(data.fields).toEqual([
      { label: 'IP-Adresse', value: '10.0.0.20' },
      { label: 'Passwort', value: '••••••' }
    ])
    expect(data.checklists).toEqual([{ title: 'Neustart', steps: ['Dienst stoppen'], lastRun: expect.stringContaining('alles gut') }])
    expect(data.neededBy).toEqual(['App'])
    expect(data.notes).toEqual([{ kind: 'danger', text: expect.stringContaining('Platte voll') }])
    expect(data.meta).toMatch(/von Anna · exportiert .* von Anna$/)

    // Eigener Entwurf: Inhalt aus dem Entwurf, Hinweis, Protokoll vom Original
    store.setApprovalRequired(true)
    const draft = store.startDraft(sql)
    store.renameArticle(draft, 'SQL neu')
    const fromDraft = store.exportArticle(draft)
    expect(fromDraft.title).toBe('SQL neu')
    expect(fromDraft.path).toEqual(['IT', 'Server'])
    expect(fromDraft.notes[0]).toEqual({ kind: 'warning', text: 'Entwurf von Anna – noch nicht freigegeben.' })
    expect(fromDraft.checklists[0].lastRun).toContain('alles gut')
    expect(fromDraft.neededBy).toEqual(['App'])
  })
})
