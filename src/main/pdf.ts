import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const FOOTER = `<div style="width:100%;text-align:center;font-size:8px;color:#888;font-family:'Segoe UI',sans-serif">
  <span class="pageNumber"></span> / <span class="totalPages"></span></div>`

/** Druckt eine HTML-Seite in einem unsichtbaren Fenster als A4-PDF (mit Seitenzahlen). */
export async function renderPdf(html: string): Promise<Buffer> {
  // Über eine Datei laden: data:-URLs sind bei großen Bildern zu lang
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindwiki-pdf-'))
  const file = path.join(dir, 'export.html')
  fs.writeFileSync(file, html, 'utf8')
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true }
  })
  try {
    await win.loadFile(file)
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: FOOTER
    })
  } finally {
    win.destroy()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
