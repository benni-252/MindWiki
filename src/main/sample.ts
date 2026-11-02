import fs from 'node:fs'
import { openDatabase } from './db'
import { docText } from './links'
import { WikiStore } from './store'

// Beispiel-Wiki mit erfundenen IT-Daten, damit man nach der Installation sofort sieht, wie MindWiki aussieht.
// Alle Namen, Adressen und Nummern sind ausgedacht (Domains auf .example).

type Inline = { type: string; text?: string; marks?: { type: string }[]; attrs?: Record<string, unknown> }
type Block = Record<string, unknown>

const t = (text: string): Inline => ({ type: 'text', text })
const b = (text: string): Inline => ({ type: 'text', text, marks: [{ type: 'bold' }] })
const link = (id: number, label: string): Inline => ({ type: 'articleLink', attrs: { id, label } })
const h = (text: string, level = 2): Block => ({ type: 'heading', attrs: { level }, content: [t(text)] })
const p = (...content: (Inline | string)[]): Block => ({
  type: 'paragraph',
  content: content.map((c) => (typeof c === 'string' ? t(c) : c))
})
const listOf = (type: 'bulletList' | 'orderedList', items: (Inline | string)[][]): Block => ({
  type,
  content: items.map((item) => ({ type: 'listItem', content: [p(...item)] }))
})
const ul = (...items: (Inline | string)[][]): Block => listOf('bulletList', items)
const ol = (...items: (Inline | string)[][]): Block => listOf('orderedList', items)
const table = (header: string[], rows: string[][]): Block => {
  const cell = (type: string, text: string): Block => ({ type, content: [p(text)] })
  return {
    type: 'table',
    content: [
      { type: 'tableRow', content: header.map((x) => cell('tableHeader', x)) },
      ...rows.map((r) => ({ type: 'tableRow', content: r.map((x) => cell('tableCell', x)) }))
    ]
  }
}

function setText(store: WikiStore, id: number, ...blocks: Block[]): void {
  const json = JSON.stringify({ type: 'doc', content: blocks })
  store.saveArticleContent(id, json, docText(json))
}

/** Füllt Steckbrief-Felder: vorhandene (aus der Vorlage) bekommen den Wert, fehlende werden angelegt. */
function setFields(store: WikiStore, id: number, values: Record<string, string>): void {
  const fields = store.getFields(id)
  for (const [label, value] of Object.entries(values)) {
    const field = fields.find((f) => f.label === label)
    if (field) store.updateField(field.id, label, value)
    else store.addField(id, label, value)
  }
  // Leere Vorlagen-Felder entfernen, damit der Steckbrief aufgeräumt aussieht
  for (const f of store.getFields(id)) if (!f.value) store.deleteField(f.id)
}

/** Erstes Ablauf-Protokoll eintragen: alle Schritte abhaken und abschließen. */
function completeFirstRun(store: WikiStore, id: number, note: string): void {
  const list = store.getChecklists(id)[0]
  if (!list) return
  for (const item of list.items) store.setItemChecked(item.id, true)
  store.completeRun(list.id, note)
}

/** Legt das Beispiel-Wiki in einem leeren Wiki an. */
export function fillSampleWiki(store: WikiStore): void {
  const root = store.rootId()
  const add = (parent: number, title: string, icon: string | null, template: string | null = null): number => {
    const id = store.createArticle(parent, title, null, template)
    if (icon) store.setArticleIcon(id, icon)
    return id
  }
  store.author = 'Anna'

  // ---------- Struktur ----------
  const net = add(root, 'Netzwerk', 'network')
  const coreSwitch = add(net, 'Core-Switch', 'network', 'network')
  const firewall = add(net, 'Firewall', 'router', 'network')
  const wlan = add(net, 'WLAN', 'wifi')

  const servers = add(root, 'Server', 'server')
  const dc = add(servers, 'SRV-DC01', 'server', 'server')
  const sql = add(servers, 'SRV-SQL01', 'database', 'server')
  const app = add(servers, 'SRV-APP01', 'server', 'server')
  const nas = add(servers, 'Backup-NAS', 'storage')

  const software = add(root, 'Software', 'app')
  const erp = add(software, 'Warenwirtschaft', 'app', 'software')
  const office = add(software, 'E-Mail & Office', 'cloud')
  const vpn = add(software, 'VPN', 'security')

  const workplaces = add(root, 'Arbeitsplätze', 'monitor')
  const printer = add(workplaces, 'Drucker 1. OG', 'printer')
  const onboarding = add(workplaces, 'Neuer Mitarbeiter', 'book', 'howto')

  const issues = add(root, 'Störungen & Lösungen', 'alert')
  const printIssue = add(issues, 'Drucker druckt nicht', 'printer', 'incident')
  const vpnIssue = add(issues, 'VPN trennt sich ständig', 'security', 'incident')

  const vendors = add(root, 'Dienstleister', 'headset')
  const supplier = add(vendors, 'Systemhaus Müller', 'headset', 'contact')

  // ---------- Startseite ----------
  setText(
    store,
    root,
    h('Willkommen im Beispiel-Wiki'),
    p('Alle Daten hier sind ', b('erfunden'), ' – klick dich durch und probier alles aus, du kannst nichts kaputt machen.'),
    h('So geht’s'),
    ul(
      ['Ein Klick auf einen Knoten öffnet den Artikel, ein Rechtsklick zeigt alle Aktionen.'],
      [
        b('SRV-SQL01'),
        ' hat gerade eine ',
        b('Störung'),
        ' (rot). Alles, was davon abhängt, ist orange – zum Beispiel die Warenwirtschaft. Rechtsklick › „Störung beheben“ setzt das zurück.'
      ],
      ['Tab legt einen Unterartikel an, Enter einen daneben, F2 benennt um, Leertaste klappt einen Ast ein.'],
      ['Strg+K sucht im ganzen Wiki – auch in Steckbriefen, z. B. nach „10.0.10.20“.'],
      ['Im Text verlinkt „[[“ einen anderen Artikel; die Links erscheinen als gestrichelte Linien.'],
      ['Unten in jedem Artikel steht im Verlauf, wer wann was geändert hat.']
    ),
    h('Eigenes Wiki anlegen'),
    p(
      'Wenn du so weit bist: ',
      b('Datei › Neues Wiki…'),
      ' legt eine leere Datei an. Dieses Beispiel bleibt unter ',
      b('Hilfe › Beispiel-Wiki öffnen'),
      ' erreichbar.'
    )
  )

  // ---------- Netzwerk ----------
  setText(
    store,
    net,
    h('IP-Bereiche'),
    table(
      ['Netz', 'VLAN', 'Zweck'],
      [
        ['10.0.10.0/24', '10', 'Server'],
        ['10.0.20.0/24', '20', 'Arbeitsplätze'],
        ['10.0.30.0/24', '30', 'Drucker & Geräte'],
        ['10.0.40.0/24', '40', 'Gäste-WLAN (nur Internet)'],
        ['10.0.99.0/24', '99', 'Verwaltung']
      ]
    ),
    p('Zentrale Geräte sind der Core-Switch und die Firewall.')
  )
  setFields(store, coreSwitch, {
    Hostname: 'core-sw01',
    'IP-Adresse': '10.0.99.2',
    'Hersteller / Modell': 'Beispielnetz CS-48',
    Firmware: '9.3.1',
    Seriennummer: 'CS48-000123',
    Standort: 'Serverraum UG, Rack 2',
    VLANs: '10, 20, 30, 40, 99',
    'Verwaltungsoberfläche (URL)': 'https://10.0.99.2'
  })
  setText(
    store,
    coreSwitch,
    h('Überblick'),
    p('Zentraler Switch im Serverraum. Alle Server, Access Points und Etagen-Switches hängen hier dran.'),
    h('Ports / Verkabelung'),
    ul(['Port 1–8: Server'], ['Port 9–12: Etagen-Switches EG, 1. OG, 2. OG'], ['Port 47–48: Uplink zur Firewall']),
    h('Konfiguration'),
    p('Konfiguration wird nach jeder Änderung auf das ', link(nas, 'Backup-NAS'), ' gesichert.')
  )
  completeFirstRun(store, coreSwitch, 'Update auf 9.3.1, keine Auffälligkeiten.')

  setFields(store, firewall, {
    Hostname: 'fw01',
    'IP-Adresse': '10.0.99.1',
    'Hersteller / Modell': 'Beispiel-Firewall FX 200',
    Firmware: '7.4.2',
    Standort: 'Serverraum UG, Rack 1',
    'Verwaltungsoberfläche (URL)': 'https://10.0.99.1'
  })
  setText(
    store,
    firewall,
    h('Überblick'),
    p('Verbindung ins Internet, VPN-Einwahl und Trennung der Netze.'),
    h('Wichtige Regeln'),
    ul(
      ['VPN für das Homeoffice über Port 443 (siehe ', link(vpn, 'VPN'), ')'],
      ['Gäste-WLAN darf nur ins Internet, nicht ins Firmennetz'],
      ['Server gehen nur über den Proxy ins Internet']
    )
  )

  setFields(store, wlan, {
    'SSID intern': 'Firma-Intern',
    'SSID Gäste': 'Firma-Gast',
    'Access Points': '3 Stück (EG, 1. OG, 2. OG)',
    Passwort: 'steht im Passwort-Manager'
  })
  setText(store, wlan, p('Gäste-Zugang wechselt jeden Monat; das neue Passwort hängt am Empfang aus.'))

  // ---------- Server ----------
  setText(store, servers, p('Alle Server laufen als virtuelle Maschinen. Wartungsfenster ist mittwochs ab 20 Uhr.'))
  setFields(store, dc, {
    Hostname: 'srv-dc01.firma.example',
    'IP-Adresse': '10.0.10.10',
    Betriebssystem: 'Windows Server 2025',
    'Rolle / Dienste': 'Active Directory, DNS, DHCP',
    'Hardware / VM': 'VM, 4 vCPU, 16 GB RAM',
    Standort: 'Serverraum UG',
    Ansprechpartner: 'Anna',
    Wartungsfenster: 'Mi 20–22 Uhr',
    Backup: 'täglich 23 Uhr auf Backup-NAS'
  })
  setText(
    store,
    dc,
    h('Überblick'),
    p('Anmeldung, Namensauflösung und IP-Vergabe für das ganze Haus.'),
    h('Konfiguration'),
    ul(['DHCP-Bereich Arbeitsplätze: 10.0.20.50–10.0.20.250'], ['DNS-Weiterleitung an die Firewall']),
    h('Bekannte Probleme'),
    p('Nach Windows-Updates einmal prüfen, ob der DHCP-Dienst wieder läuft.')
  )
  completeFirstRun(store, dc, 'Monatliche Updates eingespielt.')

  setFields(store, sql, {
    Hostname: 'srv-sql01.firma.example',
    'IP-Adresse': '10.0.10.20',
    Betriebssystem: 'Windows Server 2025',
    'Rolle / Dienste': 'SQL Server – Datenbank der Warenwirtschaft',
    'Hardware / VM': 'VM, 8 vCPU, 32 GB RAM',
    Backup: 'stündlich Transaktionslog, nachts Vollsicherung'
  })
  setText(
    store,
    sql,
    h('Überblick'),
    p('Datenbankserver für die ', link(erp, 'Warenwirtschaft'), '.'),
    h('Bekannte Probleme'),
    p('Wenn das Laufwerk D: voll ist, bleibt die Warenwirtschaft stehen. Alte Sicherungen liegen auf dem ', link(nas, 'Backup-NAS'), '.')
  )

  setFields(store, app, {
    Hostname: 'srv-app01.firma.example',
    'IP-Adresse': '10.0.10.21',
    Betriebssystem: 'Windows Server 2025',
    'Rolle / Dienste': 'Anwendungsserver Warenwirtschaft',
    'Hardware / VM': 'VM, 4 vCPU, 16 GB RAM'
  })
  setText(store, app, h('Überblick'), p('Hier läuft der Server-Teil der ', link(erp, 'Warenwirtschaft'), '.'))

  setFields(store, nas, {
    Hostname: 'nas01',
    'IP-Adresse': '10.0.10.30',
    Kapazität: '8 TB (RAID 6)',
    Aufbewahrung: '30 Tage, monatlich eine Kopie außer Haus'
  })

  // ---------- Software ----------
  setFields(store, erp, {
    Hersteller: 'Beispiel Software GmbH',
    Version: '12.4',
    Lizenz: '25 gleichzeitige Benutzer',
    'Lizenz gültig bis': '31.12.2027',
    'Installiert auf': 'SRV-APP01',
    'Support-Kontakt': 'Systemhaus Müller',
    'Download / Portal': 'https://portal.software.example'
  })
  setText(
    store,
    erp,
    h('Zweck'),
    p('Aufträge, Lager und Rechnungen. Läuft auf ', link(app, 'SRV-APP01'), ', die Daten liegen auf ', link(sql, 'SRV-SQL01'), '.'),
    h('Bekannte Probleme'),
    p('Bei Problemen zuerst den Dienst auf dem Anwendungsserver neu starten, dann den ', link(supplier, 'Systemhaus Müller'), ' anrufen.')
  )
  setFields(store, office, {
    Anbieter: 'Cloud-Dienst (Beispiel)',
    Lizenzen: '22 Benutzer',
    'Admin-Portal': 'https://admin.office.example'
  })
  setFields(store, vpn, { Client: 'Beispiel-VPN 5', Server: 'vpn.firma.example', Anmeldung: 'Windows-Konto + App-Bestätigung' })
  setText(store, vpn, p('Für das Homeoffice. Einrichtung siehe ', link(onboarding, 'Neuer Mitarbeiter'), '.'))

  // ---------- Arbeitsplätze ----------
  setFields(store, printer, {
    Modell: 'Beispiel Laser 4100',
    'IP-Adresse': '10.0.30.15',
    Standort: 'Flur 1. OG',
    Toner: 'Typ 26A, liegt im Lagerschrank'
  })
  setFields(store, onboarding, { Zielgruppe: 'IT', Dauer: 'ca. 2 Stunden', Voraussetzungen: 'Vertrag und Startdatum von der Personalabteilung' })
  setText(
    store,
    onboarding,
    h('Ziel'),
    p('Am ersten Tag hat die neue Kollegin alles, was sie braucht: Anmeldung, E-Mail, Drucker und VPN.'),
    h('Hinweise'),
    p('Den Drucker findet man unter ', link(printer, 'Drucker 1. OG'), '. Fürs Homeoffice das ', link(vpn, 'VPN'), ' einrichten.')
  )
  const steps = store.getChecklists(onboarding)[0]
  if (steps) {
    store.renameChecklist(steps.id, 'Einrichtung')
    const texts = [
      'Benutzer im Active Directory anlegen',
      'E-Mail-Postfach und Lizenz zuweisen',
      'Notebook vorbereiten (Updates, Programme)',
      'Drucker verbinden',
      'VPN-Zugang einrichten',
      'Passwort-Manager erklären'
    ]
    steps.items.forEach((item, i) => store.updateItemText(item.id, texts[i] ?? item.text))
    for (const text of texts.slice(steps.items.length)) store.addItem(steps.id, text)
  }

  // ---------- Bekannte Störungen ----------
  setFields(store, printIssue, {
    'Betroffenes System': 'Drucker 1. OG',
    Fehlermeldung: 'Druckauftrag bleibt in der Warteschlange hängen',
    Häufigkeit: 'etwa einmal im Monat',
    Ticket: '#1042'
  })
  setText(
    store,
    printIssue,
    h('Symptome'),
    p('Aufträge kommen nicht an, der Drucker zeigt „Bereit“.'),
    h('Ursache'),
    p('Der Druckerwarteschlangen-Dienst am Arbeitsplatz hängt.'),
    h('Lösung'),
    ol(['Dienst „Druckwarteschlange“ neu starten'], ['Hängende Aufträge löschen'], ['Testseite drucken']),
    h('Workaround'),
    p('Über ', link(printer, 'Drucker 1. OG'), ' per IP-Adresse direkt drucken.')
  )
  setFields(store, vpnIssue, {
    'Betroffenes System': 'VPN',
    Fehlermeldung: 'Verbindung getrennt (Zeitüberschreitung)',
    Häufigkeit: 'bei schwachem WLAN zu Hause',
    'Zuletzt aufgetreten': 'letzte Woche'
  })
  setText(
    store,
    vpnIssue,
    h('Symptome'),
    p('Die VPN-Verbindung bricht alle paar Minuten ab.'),
    h('Lösung'),
    p('Im ', link(vpn, 'VPN'), '-Client „TCP statt UDP“ einschalten. Hilft das nicht, Router zu Hause neu starten.')
  )

  // ---------- Dienstleister ----------
  setFields(store, supplier, {
    Firma: 'Systemhaus Müller GmbH (erfunden)',
    Ansprechpartner: 'Herr Müller',
    Telefon: '0123 456789',
    'E-Mail': 'support@systemhaus.example',
    Kundennummer: 'K-10042',
    'Vertrag / SLA': 'Reaktion in 4 Stunden, Mo–Fr 8–17 Uhr',
    'Support-Portal': 'https://support.systemhaus.example'
  })
  setText(
    store,
    supplier,
    h('Leistungen'),
    ul(['Wartung der Server'], ['Support für die Warenwirtschaft'], ['Notfall-Hotline']),
    h('Eskalation'),
    p('Erst Ticket im Portal, nach 4 Stunden ohne Antwort anrufen.')
  )

  // Vorlagen bringen überall Abläufe mit – im Beispiel nur dort behalten, wo sie etwas zeigen
  for (const id of [firewall, sql, app, erp, vpnIssue]) {
    for (const list of store.getChecklists(id)) store.deleteChecklist(list.id)
  }

  // ---------- Abhängigkeiten ----------
  const dependsOn: [number, number][] = [
    [firewall, coreSwitch],
    [wlan, coreSwitch],
    [dc, coreSwitch],
    [sql, coreSwitch],
    [nas, coreSwitch],
    [app, sql],
    [app, dc],
    [erp, app],
    [printer, coreSwitch],
    [vpn, firewall],
    [office, firewall]
  ]
  for (const [a, dep] of dependsOn) store.addDependency(a, dep)

  // ---------- Etwas Verlauf von einer zweiten Person ----------
  store.author = 'Ben'
  const window = store.getFields(dc).find((f) => f.label === 'Wartungsfenster')
  if (window) store.updateField(window.id, 'Wartungsfenster', 'Mi 20–23 Uhr')
  completeFirstRun(store, printIssue, 'Bei Kollegin im 1. OG, Dienst neu gestartet – lief wieder.')

  // ---------- Eine laufende Beispiel-Störung ----------
  store.reportOutage(sql, 'Beispiel: Laufwerk D: voll – zum Ausprobieren über „Störung beheben“ zurücksetzen')

  // Kleinere Äste eingeklappt lassen, damit die Mind Map übersichtlich startet
  store.setCollapsed(vendors, true)
  store.author = 'Anna'
}

/** Legt das Beispiel-Wiki als eigene Datei an, falls es sie noch nicht gibt, und liefert den Pfad. */
export function ensureSampleWiki(file: string): string {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file
  const db = openDatabase(file, 'Beispiel-Wiki')
  try {
    const store = new WikiStore(db, 'Anna')
    fillSampleWiki(store)
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('sample', '1')").run()
  } finally {
    db.close()
  }
  return file
}
