import type { ProxyPrompt } from '../shared/types'

// Anmeldung an einem Firmen-Proxy, der Benutzername und Passwort verlangt (Update-Prüfung).
// Ohne Antwort auf die Anfrage bliebe die Verbindung sonst einfach hängen.

export interface ProxyCredentials {
  username: string
  password: string
}

/** Was Electron beim 'login'-Ereignis mitgibt (Ausschnitt von Electron.AuthInfo). */
export interface ProxyAuthInfo {
  isProxy: boolean
  host: string
  port: number
  realm?: string
}

/** Antwort an Electron: ohne Argumente = Anmeldung abbrechen. */
export type LoginCallback = (username?: string, password?: string) => void

/** Dauerhaft gemerkte Anmeldungen (im Programm verschlüsselt für das Windows-Konto). */
export interface ProxyVault {
  canRemember(): boolean
  load(key: string): ProxyCredentials | null
  save(key: string, credentials: ProxyCredentials | null): void
}

export interface ProxyLoginDeps {
  /** Zeigt die Abfrage (oder schließt sie mit null); false, wenn kein Fenster da ist. */
  ask(prompt: ProxyPrompt | null): boolean
  vault: ProxyVault
  now(): number
}

/** Kommt die nächste Anfrage so schnell nach einer Antwort, hat der Proxy sie abgelehnt. */
export const REJECTED_WITHIN_MS = 5000

interface Pending {
  key: string
  prompt: ProxyPrompt
  callbacks: LoginCallback[]
}

export class ProxyLogin {
  /** In dieser Sitzung eingegebene Anmeldungen */
  private known = new Map<string, ProxyCredentials>()
  private suppliedAt = new Map<string, number>()
  private lastUsername = new Map<string, string>()
  private pending: Pending | null = null
  private attempts = 0
  /** Nach „Abbrechen“ nicht mehr von selbst fragen – erst wieder bei „Nach Updates suchen“ */
  private declined = false

  constructor(private readonly deps: ProxyLoginDeps) {}

  /** Für Electrons 'login'-Ereignis (Anfrage oder electron-updater). */
  handle(info: ProxyAuthInfo, callback: LoginCallback): void {
    // Nur Proxys; Webseiten mit Anmeldung gibt es bei der Update-Prüfung nicht
    if (!info.isProxy) {
      callback()
      return
    }
    const key = `${info.host}:${info.port}`
    if (this.pending) {
      if (this.pending.key === key) this.pending.callbacks.push(callback)
      else callback()
      return
    }

    const saved = this.known.get(key) ?? this.deps.vault.load(key)
    const rejected = this.deps.now() - (this.suppliedAt.get(key) ?? -Infinity) < REJECTED_WITHIN_MS
    if (saved && !rejected) {
      this.supply(key, saved, [callback])
      return
    }
    if (rejected) this.known.delete(key)
    if (this.declined) {
      callback()
      return
    }

    this.attempts += 1
    const prompt: ProxyPrompt = {
      host: key,
      realm: info.realm ?? '',
      username: this.lastUsername.get(key) ?? saved?.username ?? '',
      failed: rejected,
      canRemember: this.deps.vault.canRemember(),
      attempt: this.attempts
    }
    this.pending = { key, prompt, callbacks: [callback] }
    if (!this.deps.ask(prompt)) this.cancel()
  }

  /** Aktuell offene Abfrage (z. B. nachdem die Oberfläche neu geladen wurde). */
  current(): ProxyPrompt | null {
    return this.pending?.prompt ?? null
  }

  answer(username: string, password: string, remember: boolean): void {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    this.deps.ask(null)
    const credentials = { username: username.trim(), password }
    this.known.set(pending.key, credentials)
    this.lastUsername.set(pending.key, credentials.username)
    if (this.deps.vault.canRemember()) this.deps.vault.save(pending.key, remember ? credentials : null)
    this.supply(pending.key, credentials, pending.callbacks)
  }

  cancel(): void {
    const pending = this.pending
    this.declined = true
    if (!pending) return
    this.pending = null
    this.deps.ask(null)
    for (const callback of pending.callbacks) callback()
  }

  /** Bei „Nach Updates suchen“ darf wieder gefragt werden. */
  allowPrompt(): void {
    this.declined = false
  }

  /** Vergisst alle Anmeldungen (gespeicherte und die dieser Sitzung). */
  forget(keys: string[]): void {
    this.known.clear()
    this.suppliedAt.clear()
    for (const key of keys) this.deps.vault.save(key, null)
  }

  private supply(key: string, credentials: ProxyCredentials, callbacks: LoginCallback[]): void {
    this.suppliedAt.set(key, this.deps.now())
    for (const callback of callbacks) callback(credentials.username, credentials.password)
  }
}
