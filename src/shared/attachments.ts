// Regeln für Anhänge – im Hauptprozess (verbindlich) und in der Oberfläche (frühe Rückmeldung).

/** Größte erlaubte Datei: Anhänge liegen in der Wiki-Datei und in jeder Sicherung. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

/**
 * Dateitypen, die beim Öffnen Programme starten würden. Ein Wiki wird von vielen geteilt –
 * so kann niemand Schadsoftware als „Anhang“ hinterlegen, die andere per Doppelklick starten.
 */
const BLOCKED = new Set([
  'exe', 'com', 'scr', 'pif', 'msi', 'msp', 'msix', 'appx', 'appxbundle', 'bat', 'cmd', 'ps1', 'psm1', 'psd1',
  'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'cpl', 'jar', 'lnk', 'url', 'scf', 'reg', 'inf', 'dll', 'sys',
  'gadget', 'application', 'msc', 'chm', 'appref-ms', 'settingcontent-ms', 'library-ms', 'iso', 'img', 'vhd', 'vhdx'
])

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  txt: 'text/plain',
  csv: 'text/csv',
  log: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  vsdx: 'application/vnd.ms-visio.drawing',
  msg: 'application/vnd.ms-outlook',
  eml: 'message/rfc822'
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Gesperrter Dateityp? (auch „rechnung.pdf.exe“ – es zählt die letzte Endung) */
export function isBlockedAttachment(name: string): boolean {
  // Windows ignoriert Punkte und Leerzeichen am Ende: „virus.exe.“ wäre sonst ein Schlupfloch
  return BLOCKED.has(extensionOf(name.replace(/[.\s]+$/, '')))
}

export function mimeOf(name: string): string {
  return MIME[extensionOf(name)] ?? 'application/octet-stream'
}

/** Nur der Dateiname, ohne Pfad und ohne Zeichen, die Windows in Dateinamen nicht erlaubt. */
export function cleanAttachmentName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/[.\s]+$/, '')
    .trim()
  if (!cleaned) return 'Anhang'
  if (cleaned.length <= 150) return cleaned
  const ext = extensionOf(cleaned)
  return ext && ext.length < 12 ? `${cleaned.slice(0, 149 - ext.length)}.${ext}` : cleaned.slice(0, 150)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Byte`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`
}
