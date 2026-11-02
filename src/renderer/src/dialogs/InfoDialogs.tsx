import { useCallback } from 'react'
import { useWiki } from '../store'
import { Modal } from './Modal'

const SHORTCUTS: [string, string][] = [
  ['Mind Map', ''],
  ['Tab', 'Unterartikel anlegen'],
  ['Enter', 'Artikel daneben anlegen'],
  ['Strg+Enter', 'Artikel öffnen'],
  ['F2 / Doppelklick', 'Umbenennen'],
  ['Entf', 'In den Papierkorb'],
  ['Leertaste', 'Ast ein-/ausklappen'],
  ['Pfeiltasten', 'Zwischen Artikeln wechseln'],
  ['Alt+↑ / Alt+↓', 'Reihenfolge ändern'],
  ['Ziehen auf anderen Artikel', 'Umhängen'],
  ['Esc', 'Artikel schließen'],
  ['Allgemein', ''],
  ['Strg+K', 'Suchen'],
  ['Strg+Umschalt+H', 'Letzte Änderungen'],
  ['Strg+L', 'Querverweise ein/aus'],
  ['Strg+0', 'Ganze Mind Map zeigen'],
  ['Strg+N / Strg+O', 'Neues Wiki / Wiki öffnen'],
  ['Strg+Umschalt+S', 'Sicherung erstellen'],
  ['Editor', ''],
  ['[[', 'Anderen Artikel verlinken'],
  ['Strg+V', 'Text oder Bild (Screenshot) einfügen'],
  ['Strg+B / I / U', 'Fett / Kursiv / Unterstrichen'],
  ['Strg+Klick', 'Weblink öffnen']
]

export function ShortcutsDialog(): React.JSX.Element {
  const close = useCallback(() => useWiki.getState().setDialog(null), [])
  return (
    <Modal title="Tastaturkürzel" onClose={close}>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([key, text]) =>
            text ? (
              <tr key={key}>
                <td>
                  <kbd>{key}</kbd>
                </td>
                <td>{text}</td>
              </tr>
            ) : (
              <tr key={key} className="group">
                <th colSpan={2}>{key}</th>
              </tr>
            )
          )}
        </tbody>
      </table>
    </Modal>
  )
}

export function AboutDialog(): React.JSX.Element {
  const close = useCallback(() => useWiki.getState().setDialog(null), [])
  const dbInfo = useWiki((s) => s.dbInfo)
  return (
    <Modal title="Über MindWiki" onClose={close}>
      <p>
        <strong>MindWiki {__APP_VERSION__}</strong> – ein lokales Wiki als Mind Map mit abhakbaren Abläufen.
      </p>
      <p className="muted small">Alle Daten liegen in einer einzigen Datei auf diesem Rechner:</p>
      <p className="path">{dbInfo?.path}</p>
      <p className="muted small">
        Beim Start wird höchstens einmal täglich automatisch eine Sicherung im Unterordner „Sicherungen“ angelegt (die
        letzten 5 bleiben erhalten).
      </p>
    </Modal>
  )
}
