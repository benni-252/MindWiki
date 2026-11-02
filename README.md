# MindWiki

Lokales Wiki als Mind Map: Artikel hängen in einem Baum (Hauptthema in der Mitte), können per `[[` aufeinander verweisen und enthalten abhakbare Abläufe mit Protokoll. Alles liegt in **einer** SQLite-Datei auf deinem Rechner.

## Programm benutzen

- **Herunterladen:** Die fertigen .exe-Dateien liegen auf GitHub unter **Releases** (rechts auf der Repo-Seite). Im Repository selbst sind sie absichtlich nicht enthalten (`dist/` steht in `.gitignore`), sie werden vom Workflow `Windows-Build` erzeugt – siehe [Windows-Programme auf GitHub bauen](#windows-programme-auf-github-bauen).
- **Installieren:** `MindWiki-Setup-1.0.0.exe` ausführen – oder ohne Installation `MindWiki-1.0.0-portable.exe` starten.
  Die .exe ist nicht signiert; Windows SmartScreen fragt beim ersten Start nach („Weitere Informationen“ → „Trotzdem ausführen“).
- **Daten:** standardmäßig `Dokumente\MindWiki\Wiki.db`. Über *Datei › Neues Wiki / Wiki öffnen* kannst du weitere Wikis anlegen bzw. wechseln.
- **Sicherungen:** beim Start höchstens einmal pro Tag automatisch in `Sicherungen\` neben der Datenbank (die letzten 5 bleiben). Manuell: *Datei › Sicherung erstellen* (Strg+Umschalt+S).
- **Papierkorb:** Gelöschte Äste lassen sich unter *Bearbeiten › Papierkorb* wiederherstellen.

### IT-Funktionen

- **Vorlagen:** Server / System, Netzwerkgerät, Software, Anleitung, Störung / Fehlerbehebung, Dienstleister / Kontakt – jeweils mit Steckbrief-Feldern, Gliederung und passendem Ablauf. Erreichbar über den Plus-Knopf oben, per Rechtsklick „Unterartikel aus Vorlage“ oder in einem leeren Artikel über „Mit Vorlage starten“.
- **Steckbrief:** frei benennbare Felder (Hostname, IP-Adresse, Standort …) oben im Artikel, mit Kopieren-Knopf und Vorschlägen beim Tippen; die Suche findet auch Feldwerte. Passwörter gehören in einen Passwort-Manager – die Wiki-Datei ist nicht verschlüsselt.
- **Abhängigkeiten:** Im Artikel unter „Abhängigkeiten“ eintragen, wovon er abhängt (z. B. Warenwirtschaft → App-Server → SQL-Server → Core-Switch) – oder umgekehrt, welche Artikel ihn brauchen. In der Mind Map erscheinen sie als türkise Pfeile (zusammen mit den Querverweisen ein-/ausblendbar). Der Pfeil zeigt, wohin sich eine Störung ausbreitet.
- **Störungen:** Rechtsklick auf einen Artikel › „Störung melden“ (oder das Warndreieck oben im Artikel). Der Artikel wird rot, alles, was direkt oder über mehrere Stufen davon abhängt, orange. Die Wege der Störung sind als rote Pfeile immer zu sehen, und eingeklappte Äste färben ihren Zähler ein. Im gestörten Artikel stehen Beginn, eine Notiz und die direkt bzw. indirekt betroffenen Artikel; ein betroffener Artikel zeigt, über welchen Weg ihn die Störung erreicht. Oben erscheint „1 Störung · 4 betroffen“ – ein Klick öffnet die Übersicht (auch *Ansicht › Störungen und Auswirkungen*). „Störung beheben“ setzt alles zurück.
- **Symbole:** 35 IT-Symbole (Server, Netzwerk, Drucker, Datenbank, Cloud …) für die Knoten – per Rechtsklick „Symbol wählen“ oder über das Symbol neben dem Artikeltitel.

### Wichtigste Kürzel (F1 zeigt alle)

| Kürzel | Wirkung |
|---|---|
| Tab / Enter | Unterartikel / Artikel daneben anlegen |
| F2, Doppelklick | Umbenennen |
| Leertaste | Ast ein-/ausklappen |
| Pfeiltasten, Alt+↑/↓ | Navigieren, Reihenfolge ändern |
| Knoten auf anderen ziehen | Umhängen |
| Strg+K | Suchen (Titel, Text, Ablaufschritte) |
| `[[` im Text | Anderen Artikel verlinken (erscheint als gestrichelte Linie in der Mind Map) |
| Strg+V | Bild/Screenshot einfügen |

## Entwicklung

Voraussetzung: Node.js 24.

```bash
npm install
npm run dev          # App mit Live-Neuladen starten
npm test             # Unit-Tests (Datenbank, Layout)
npm run e2e          # baut und testet die echte App mit Playwright
npm run typecheck
npm run build:win    # Installer + portable .exe nach dist\
node scripts/make-icon.mjs   # App-Symbol neu erzeugen
```

Falls Electron beim ersten Start fehlt: `node node_modules/electron/install.js`.

### Windows-Programme auf GitHub bauen

Der Workflow `.github/workflows/windows-build.yml` baut Installer und portable .exe auf einem Windows-Rechner von GitHub:

- **Neues Release:** Auf GitHub unter *Releases › Draft a new release* einen Tag wie `v1.0.0` anlegen und veröffentlichen. Nach ein paar Minuten hängen beide .exe-Dateien am Release.
- **Nur testweise bauen:** *Actions › Windows-Build › Run workflow*. Die .exe-Dateien liegen danach im Lauf unter *Artifacts* als ZIP.

Die Version im Dateinamen kommt aus `version` in `package.json` – vor einem neuen Release dort erhöhen.

### Aufbau

- `src/main` – Electron-Hauptprozess: Datenbank (`db.ts`, `store.ts`, eingebautes `node:sqlite`), IPC (`ipc.ts`), Fenster/Menü (`index.ts`), Bilder über das Protokoll `wikiimg://`
- `src/preload` – stellt der Oberfläche die typisierte `window.wiki`-API bereit
- `src/shared/types.ts` – gemeinsame Typen und Liste der IPC-Methoden
- `src/shared/impact.ts` – welche Artikel von einer Störung betroffen sind (über die Abhängigkeiten)
- `src/renderer/src` – React-Oberfläche: `mindmap/` (React Flow + Layout), `article/` (TipTap-Editor), `checklist/` (Abläufe), `dialogs/`
