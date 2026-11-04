import { WikiError } from './store'

// SQLite meldet Probleme mit der Datei nur knapp auf Englisch („database is locked“).
// Für die Oberfläche: verständlich, mit Hinweis auf die übliche Ursache (Netzlaufwerk).

const SQLITE_BUSY = 5
const SQLITE_LOCKED = 6
const SQLITE_READONLY = 8
const SQLITE_IOERR = 10
const SQLITE_CORRUPT = 11
const SQLITE_FULL = 13
const SQLITE_CANTOPEN = 14
const SQLITE_NOTADB = 26

export const UNREACHABLE =
  'Die Wiki-Datei ist gerade nicht erreichbar – ist das Netzlaufwerk getrennt oder die Verbindung unterbrochen?'

/** Übersetzt SQLite-Fehler in eine WikiError mit deutschem Text; andere Fehler bleiben, wie sie sind. */
export function friendlyDbError(err: unknown): unknown {
  const e = err as { code?: unknown; errcode?: unknown } | null
  if (!e || typeof e !== 'object' || e.code !== 'ERR_SQLITE_ERROR') return err
  // Erweiterte Codes (z. B. 266 = IOERR_READ) tragen den Grundcode im unteren Byte
  switch (Number(e.errcode) & 0xff) {
    case SQLITE_BUSY:
    case SQLITE_LOCKED:
      return new WikiError(
        'Die Wiki-Datei ist gerade gesperrt oder nicht erreichbar – vielleicht speichert gerade jemand anderes, oder das Netzlaufwerk hängt.'
      )
    case SQLITE_IOERR:
    case SQLITE_CANTOPEN:
      return new WikiError(UNREACHABLE)
    case SQLITE_READONLY:
      return new WikiError('Die Wiki-Datei ist schreibgeschützt – es fehlen die Rechte zum Speichern.')
    case SQLITE_FULL:
      return new WikiError('Auf dem Laufwerk der Wiki-Datei ist kein Platz mehr.')
    case SQLITE_CORRUPT:
    case SQLITE_NOTADB:
      return new WikiError('Die Wiki-Datei ist beschädigt. Öffne eine Sicherung (Ordner „Sicherungen“ neben der Datei).')
    default:
      return err
  }
}
