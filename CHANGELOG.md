# Änderungen

Jeder Abschnitt wird automatisch zur Beschreibung des Releases dieser Version (siehe `.github/workflows/windows-build.yml`).

## 1.4.0

**Neu: Anmeldung mit Benutzern und Rollen**
- Beim Start meldet man sich mit Benutzername und Passwort an. Jedes Wiki hat den Admin `admin` – anfangs mit dem Passwort `admin`, bitte gleich ändern.
- Nur der Admin legt Benutzer an, vergibt Rollen, setzt Passwörter zurück und löscht Benutzer.
- *Mitarbeiter* verfassen Artikel, *Bearbeiter* verfassen und geben frei (nie die eigenen).
- Artikel gelöschter Benutzer bleiben erhalten und sind gekennzeichnet.
- Bestehende Wikis: nach dem Update mit `admin` / `admin` anmelden und die Benutzer anlegen.

**Neu: Updates direkt aus der App**
- Die installierte Version prüft beim Start und alle paar Stunden, ob es eine neue Version gibt. Oben erscheint dann „Update … verfügbar“; ein Klick lädt sie herunter und installiert sie mit einem kurzen Neustart. Deine Daten bleiben erhalten.
- Von Hand: *Hilfe › Nach Updates suchen…*. Die portable Version zeigt einen Hinweis und öffnet die Download-Seite.
- Diese Version musst du einmal von Hand installieren – ab dann kommen Updates von selbst.

**Freigaben besser sichtbar**
- Noch nicht freigegebener Text ist markiert: bei neuen Artikeln der ganze Text, im eigenen Entwurf die geänderten Absätze.
- Oben steht „X Freigaben offen“ – orange, wenn etwas auf dich wartet, blau für deine eigenen Entwürfe.

**Download**
- `MindWiki-Setup-1.4.0.exe` – Installer (mit automatischen Updates)
- `MindWiki-1.4.0-portable.exe` – ohne Installation starten

**Hinweis:** Die .exe ist nicht signiert. Windows SmartScreen fragt beim ersten Start nach – „Weitere Informationen“ → „Trotzdem ausführen“.

## 1.3.0

**Neu: Beispiel-Wiki**
- Beim ersten Start zeigt MindWiki ein Beispiel mit erfundenen IT-Daten: Netzwerk, Server, Software, Arbeitsplätze, bekannte Störungen und Dienstleister – mit Steckbriefen, Abläufen, Abhängigkeiten, Verlauf und einer Beispiel-Störung.
- Das Beispiel ist eine eigene Datei. *Datei › Neues Wiki* legt dein eigenes, leeres Wiki an; das Beispiel bleibt unter *Hilfe › Beispiel-Wiki öffnen* erreichbar.
- Wer schon ein Wiki benutzt, bei dem ändert sich nichts.

**Download**
- `MindWiki-Setup-1.3.0.exe` – Installer
- `MindWiki-1.3.0-portable.exe` – ohne Installation starten

**Hinweis:** Die .exe ist nicht signiert. Windows SmartScreen fragt beim ersten Start nach – „Weitere Informationen“ → „Trotzdem ausführen“.

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
