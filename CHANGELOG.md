# Änderungen

Jeder Abschnitt wird automatisch zur Beschreibung des Releases dieser Version (siehe `.github/workflows/windows-build.yml`).

## 1.2.0

**Neu: Freigaben nach dem Vier-Augen-Prinzip**
- Einschalten unter *Datei › Freigaben…* – gilt für alle, die dieselbe Wiki-Datei benutzen.
- Neue Artikel sind Entwürfe (gestrichelt), bis jemand anderes sie freigibt oder ablehnt.
- Änderungen an freigegebenen Artikeln laufen über „Bearbeiten“: Die anderen sehen den alten Stand, bis jemand den Vorschlag freigegeben hat. Vor der Freigabe zeigt ein Vergleich, was sich geändert hat (Titel, Text, Steckbrief, Abläufe).
- Das Schild-Symbol oben zeigt, wie viele Freigaben auf dich warten.
- Störungen, Abhängigkeiten und das Abhaken von Abläufen gehen weiterhin sofort.

**Download**
- `MindWiki-Setup-1.2.0.exe` – Installer
- `MindWiki-1.2.0-portable.exe` – ohne Installation starten

Beim ersten Start wird die Datenbank aktualisiert; vorher legt MindWiki automatisch eine Sicherung an. Wenn mehrere Leute dieselbe Datei benutzen, sollten alle diese Version installieren.

**Hinweis:** Die .exe ist nicht signiert. Windows SmartScreen fragt beim ersten Start nach – „Weitere Informationen“ → „Trotzdem ausführen“.

## 1.1.0

**Neu: Abhängigkeiten und Störungen**
- Artikel können voneinander abhängen (z. B. Warenwirtschaft → App-Server → SQL-Server → Core-Switch).
- Rechtsklick › „Störung melden“: Der Artikel wird rot, alles, was direkt oder über mehrere Stufen davon abhängt, orange.
- Oben in der Kopfleiste steht, wie viele Störungen es gibt und wie viele Artikel betroffen sind; ein Klick öffnet die Übersicht.

**Neu: Verlauf und gemeinsame Nutzung**
- Die Wiki-Datei kann auf einem Netzlaufwerk liegen und von mehreren Leuten gleichzeitig benutzt werden; Änderungen der anderen erscheinen nach ein bis zwei Sekunden.
- Jeder Artikel zeigt im Verlauf, wer wann was geändert hat. Frühere Textfassungen lassen sich ansehen und wiederherstellen.
- Was andere seit deinem letzten Besuch geändert haben, ist in der Mind Map mit einem blauen Punkt markiert; das Uhr-Symbol oben zeigt die Anzahl und öffnet die Liste der letzten Änderungen.

**Download**
- `MindWiki-Setup-1.1.0.exe` – Installer
- `MindWiki-1.1.0-portable.exe` – ohne Installation starten

Beim ersten Start wird die Datenbank aktualisiert; vorher legt MindWiki automatisch eine Sicherung an. Wenn mehrere Leute dieselbe Datei benutzen, sollten alle diese Version installieren.

**Hinweis:** Die .exe ist nicht signiert. Windows SmartScreen fragt beim ersten Start nach – „Weitere Informationen“ → „Trotzdem ausführen“.

## 1.0.0

Erste Version: Mind Map, Artikel mit Editor und Querverweisen, abhakbare Abläufe, IT-Vorlagen, Steckbrief-Felder und Symbole.
