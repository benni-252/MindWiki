// Verständliche Meldungen für Fehler bei der Update-Prüfung – besonders hinter Firmen-Proxys.

const BROWSER_HINT = 'Du kannst die neue Version auch über die Download-Seite im Browser holen.'

export function explainUpdateError(err: unknown): string {
  const text = String(err instanceof Error ? err.message : err)
  if (/rate limit/i.test(text)) {
    return 'GitHub hat gerade zu viele Update-Abfragen aus eurem Netz gezählt (alle Rechner hinter einem Proxy teilen sich eine Grenze). Versuch es in einer Stunde noch einmal.'
  }
  if (/\b407\b|ERR_PROXY_AUTH_(CANCELED|REQUESTED)/i.test(text)) {
    return 'Der Proxy-Server hat keine Anmeldung bekommen. Suche erneut nach Updates und gib Benutzername und Passwort für den Proxy ein.'
  }
  if (/ERR_PROXY_AUTH_UNSUPPORTED/i.test(text)) {
    return `Der Proxy-Server verlangt eine Anmeldung, die MindWiki nicht beherrscht. ${BROWSER_HINT}`
  }
  if (/ERR_PROXY_CONNECTION_FAILED|ERR_MANDATORY_PROXY_CONFIGURATION_FAILED|ERR_PAC_|ERR_PROXY_CERTIFICATE/i.test(text)) {
    return `Der Proxy-Server ist nicht erreichbar. Prüfe die Proxy-Einstellungen von Windows oder frag eure IT. ${BROWSER_HINT}`
  }
  if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_BLOCKED_BY_ADMINISTRATOR|\b403\b/i.test(text)) {
    return `Der Proxy lässt die Verbindung zu GitHub nicht zu. Eure IT kann github.com und githubusercontent.com freigeben. ${BROWSER_HINT}`
  }
  if (/ERR_CERT_|certificate/i.test(text)) {
    return `Die sichere Verbindung zu GitHub wurde abgelehnt (Zertifikat). Das passiert, wenn ein Proxy Verbindungen prüft – eure IT kann helfen. ${BROWSER_HINT}`
  }
  if (/\b404\b|Not Found/i.test(text)) {
    return 'Auf GitHub wurden keine Update-Informationen gefunden. Ist das Repository öffentlich?'
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|net::|offline/i.test(text)) {
    return 'GitHub ist gerade nicht erreichbar. Bist du mit dem Internet verbunden?'
  }
  return `Die Update-Prüfung ist fehlgeschlagen: ${text.split('\n')[0]}`
}
