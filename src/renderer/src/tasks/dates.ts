// Kalendertage als „JJJJ-MM-TT“ in Ortszeit – Fälligkeiten haben keine Uhrzeit.

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const p = (n: number): string => String(n).padStart(2, '0')

export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function fromDateString(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayString(now = new Date()): string {
  return toDateString(now)
}

export function addDays(s: string, days: number): string {
  const d = fromDateString(s)
  d.setDate(d.getDate() + days)
  return toDateString(d)
}

/** Wochentag 0 = Montag … 6 = Sonntag */
function weekday(s: string): number {
  return (fromDateString(s).getDay() + 6) % 7
}

/** Freitag bzw. Sonntag der Woche (Montag bis Sonntag), in der `s` liegt */
export const fridayOf = (s: string): string => addDays(s, 4 - weekday(s))
export const sundayOf = (s: string): string => addDays(s, 6 - weekday(s))

/** „24.11.2026“ */
export function formatDate(s: string): string {
  const [y, m, d] = s.split('-')
  return `${d}.${m}.${y}`
}

/** „Fr 28.11.“ */
export function formatWeekday(s: string): string {
  const [, m, d] = s.split('-')
  return `${WEEKDAYS[fromDateString(s).getDay()]} ${d}.${m}.`
}

/** Kurz für Karten: „Heute“, „Morgen“, „Gestern“, „Fr 28.11.“ oder mit Jahr, wenn es nicht dieses ist */
export function formatDue(s: string, today: string): string {
  if (s === today) return 'Heute'
  if (s === addDays(today, 1)) return 'Morgen'
  if (s === addDays(today, -1)) return 'Gestern'
  return s.slice(0, 4) === today.slice(0, 4) ? formatWeekday(s) : formatDate(s)
}

export type DueKey = 'overdue' | 'today' | 'tomorrow' | 'week' | 'nextweek' | 'later' | 'none'

export const DUE_ORDER: DueKey[] = ['overdue', 'today', 'tomorrow', 'week', 'nextweek', 'later', 'none']
export const DUE_LABEL: Record<DueKey, string> = {
  overdue: 'Überfällig',
  today: 'Heute',
  tomorrow: 'Morgen',
  week: 'Diese Woche',
  nextweek: 'Nächste Woche',
  later: 'Später',
  none: 'Kein Datum'
}

/** In welche Spalte „Fälligkeit“ ein Datum fällt (Wochen von Montag bis Sonntag) */
export function dueKey(date: string | null, today: string): DueKey {
  if (!date) return 'none'
  if (date < today) return 'overdue'
  if (date === today) return 'today'
  if (date === addDays(today, 1)) return 'tomorrow'
  const sunday = sundayOf(today)
  if (date <= sunday) return 'week'
  if (date <= addDays(sunday, 7)) return 'nextweek'
  return 'later'
}

/**
 * Neues Fälligkeitsdatum, wenn eine Aufgabe in diese Spalte gezogen wird: null = kein Datum,
 * undefined = dorthin kann man nicht ziehen (Überfällig, Später, „Diese Woche“ am Wochenende).
 */
export function dueDropDate(key: DueKey, today: string): string | null | undefined {
  const tomorrow = addDays(today, 1)
  switch (key) {
    case 'today':
      return today
    case 'tomorrow':
      return tomorrow
    case 'week': {
      // Freitag, wenn er noch kommt – sonst Sonntag (am Donnerstag ist Freitag schon „Morgen“)
      const friday = fridayOf(today)
      if (friday > tomorrow) return friday
      const sunday = sundayOf(today)
      return sunday > tomorrow ? sunday : undefined
    }
    case 'nextweek':
      return fridayOf(addDays(today, 7))
    case 'none':
      return null
    default:
      return undefined
  }
}

/** Schnellauswahl für die Fälligkeit im Kontextmenü (Freitag als Ziel einer Woche) */
export function quickDueOptions(today: string): { label: string; date: string }[] {
  const options = [
    { label: 'Heute', date: today },
    { label: 'Morgen', date: addDays(today, 1) }
  ]
  const week = dueDropDate('week', today)
  if (week) options.push({ label: 'Diese Woche', date: week })
  options.push({ label: 'Nächste Woche', date: nextWeekFriday(today) })
  return options
}

/** Freitag der nächsten Woche (Wochen von Montag bis Sonntag) */
export function nextWeekFriday(today: string): string {
  return fridayOf(addDays(today, 7))
}

/** Kürzel in Datumsfeldern – als Tooltip und Hinweis */
export const DATE_KEY_HINT = 'h = heute, m = morgen, n = Freitag nächste Woche'

/** Datum zu einem Kürzel im Datumsfeld: h = heute, m = morgen, n = Freitag nächste Woche; sonst null */
export function dateFromKey(key: string, today: string): string | null {
  switch (key.toLowerCase()) {
    case 'h':
      return today
    case 'm':
      return addDays(today, 1)
    case 'n':
      return nextWeekFriday(today)
    default:
      return null
  }
}
