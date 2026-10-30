// IT-Vorlagen für neue Artikel. Werden im Hauptprozess angewendet (eine Transaktion)
// und in der Oberfläche zur Auswahl angezeigt.

export interface ArticleTemplate {
  id: string
  name: string
  description: string
  /** Symbol-ID, siehe src/renderer/src/icons.tsx */
  icon: string
  /** Titel eines neu angelegten Artikels */
  title: string
  /** Bezeichnungen der Steckbrief-Felder */
  fields: string[]
  /** Zwischenüberschriften im Text */
  sections: string[]
  checklists: { title: string; steps: string[] }[]
}

export const TEMPLATES: ArticleTemplate[] = [
  {
    id: 'server',
    name: 'Server / System',
    description: 'Physischer Server, VM oder Dienst',
    icon: 'server',
    title: 'Neuer Server',
    fields: [
      'Hostname',
      'IP-Adresse',
      'Betriebssystem',
      'Rolle / Dienste',
      'Hardware / VM',
      'Standort',
      'Ansprechpartner',
      'Wartungsfenster',
      'Backup'
    ],
    sections: ['Überblick', 'Konfiguration', 'Abhängigkeiten', 'Bekannte Probleme'],
    checklists: [
      {
        title: 'Wartung / Neustart',
        steps: [
          'Benutzer informieren',
          'Letztes Backup prüfen',
          'Updates installieren',
          'Neustart durchführen',
          'Dienste und Erreichbarkeit prüfen',
          'Benutzer über Abschluss informieren'
        ]
      }
    ]
  },
  {
    id: 'network',
    name: 'Netzwerkgerät',
    description: 'Switch, Router, Firewall, Access Point',
    icon: 'network',
    title: 'Neues Netzwerkgerät',
    fields: [
      'Hostname',
      'IP-Adresse',
      'Hersteller / Modell',
      'Firmware',
      'Seriennummer',
      'Standort',
      'VLANs',
      'Verwaltungsoberfläche (URL)'
    ],
    sections: ['Überblick', 'Ports / Verkabelung', 'Konfiguration'],
    checklists: [
      {
        title: 'Firmware-Update',
        steps: [
          'Konfiguration sichern',
          'Release Notes lesen',
          'Wartungsfenster ankündigen',
          'Firmware einspielen',
          'Neustart und Funktion prüfen'
        ]
      }
    ]
  },
  {
    id: 'software',
    name: 'Software / Anwendung',
    description: 'Programm, Lizenz und Installation',
    icon: 'app',
    title: 'Neue Software',
    fields: ['Hersteller', 'Version', 'Lizenz', 'Lizenz gültig bis', 'Installiert auf', 'Support-Kontakt', 'Download / Portal'],
    sections: ['Zweck', 'Installation', 'Konfiguration', 'Bekannte Probleme'],
    checklists: [
      {
        title: 'Installation',
        steps: ['Systemvoraussetzungen prüfen', 'Installationsdatei bereitstellen', 'Installieren', 'Lizenz eintragen', 'Funktion testen']
      }
    ]
  },
  {
    id: 'howto',
    name: 'Anleitung',
    description: 'Schritt-für-Schritt-Anleitung',
    icon: 'book',
    title: 'Neue Anleitung',
    fields: ['Zielgruppe', 'Dauer', 'Voraussetzungen'],
    sections: ['Ziel', 'Hinweise'],
    checklists: [{ title: 'Schritte', steps: ['Schritt 1', 'Schritt 2', 'Schritt 3'] }]
  },
  {
    id: 'incident',
    name: 'Störung / Fehlerbehebung',
    description: 'Bekannter Fehler mit Lösung',
    icon: 'alert',
    title: 'Neue Störung',
    fields: ['Betroffenes System', 'Fehlermeldung', 'Häufigkeit', 'Zuletzt aufgetreten', 'Ticket'],
    sections: ['Symptome', 'Ursache', 'Lösung', 'Workaround'],
    checklists: [
      {
        title: 'Diagnose',
        steps: [
          'Fehlermeldung und Uhrzeit notieren',
          'Logs prüfen',
          'Netzwerkverbindung prüfen',
          'Dienst neu starten',
          'Bei Bedarf eskalieren'
        ]
      }
    ]
  },
  {
    id: 'contact',
    name: 'Dienstleister / Kontakt',
    description: 'Firma, Ansprechpartner, Vertrag',
    icon: 'headset',
    title: 'Neuer Kontakt',
    fields: ['Firma', 'Ansprechpartner', 'Telefon', 'E-Mail', 'Kundennummer', 'Vertrag / SLA', 'Support-Portal'],
    sections: ['Leistungen', 'Eskalation'],
    checklists: []
  }
]

export function findTemplate(id: string): ArticleTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

/** TipTap-Dokument mit den Zwischenüberschriften der Vorlage. */
export function templateDoc(template: ArticleTemplate): string {
  return JSON.stringify({
    type: 'doc',
    content: template.sections.flatMap((heading) => [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: heading }] },
      { type: 'paragraph' }
    ])
  })
}

/** Labels, bei denen der Steckbrief einen Hinweis auf den Passwort-Manager zeigt. */
export const SECRET_LABEL = /pass|kennw|pwd|secret|geheim|token|\bpin\b/i
