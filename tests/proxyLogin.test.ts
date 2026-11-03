import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProxyLogin, REJECTED_WITHIN_MS, type ProxyCredentials, type ProxyVault } from '../src/main/proxyLogin'
import { explainUpdateError } from '../src/main/updateErrors'
import type { ProxyPrompt } from '../src/shared/types'

const PROXY = { isProxy: true, host: 'proxy.firma.local', port: 8080, realm: 'Firma' }
const KEY = 'proxy.firma.local:8080'

let now: number
let shown: (ProxyPrompt | null)[]
let windowOpen: boolean
let saved: Map<string, ProxyCredentials>
let vault: ProxyVault
let login: ProxyLogin

/** Letzte angezeigte Abfrage */
const prompt = (): ProxyPrompt | null => shown[shown.length - 1] ?? null

beforeEach(() => {
  now = 1_000_000
  shown = []
  windowOpen = true
  saved = new Map()
  vault = {
    canRemember: () => true,
    load: (key) => saved.get(key) ?? null,
    save: (key, credentials) => (credentials ? saved.set(key, credentials) : saved.delete(key))
  }
  login = new ProxyLogin({
    ask: (p) => {
      shown.push(p)
      return windowOpen
    },
    vault,
    now: () => now
  })
})

describe('Anmeldung am Proxy', () => {
  it('fragt einmal und beantwortet alle wartenden Verbindungen', () => {
    const first = vi.fn()
    const second = vi.fn()
    login.handle(PROXY, first)
    login.handle(PROXY, second)
    expect(shown).toEqual([
      { host: KEY, realm: 'Firma', username: '', failed: false, canRemember: true, attempt: 1 }
    ])
    expect(login.current()?.host).toBe(KEY)

    login.answer(' benjamin ', 'geheim', false)
    expect(first).toHaveBeenCalledWith('benjamin', 'geheim')
    expect(second).toHaveBeenCalledWith('benjamin', 'geheim')
    expect(prompt()).toBeNull()
    expect(saved.size).toBe(0)

    // Später (neue Verbindung) wird nicht erneut gefragt
    now += 60_000
    const later = vi.fn()
    login.handle(PROXY, later)
    expect(later).toHaveBeenCalledWith('benjamin', 'geheim')
    expect(shown).toHaveLength(2)
  })

  it('erkennt ein abgelehntes Passwort und fragt erneut', () => {
    login.handle(PROXY, vi.fn())
    login.answer('benjamin', 'falsch', false)
    // Der Proxy meldet sich sofort wieder: Anmeldung abgelehnt
    now += 200
    login.handle(PROXY, vi.fn())
    expect(prompt()).toMatchObject({ failed: true, username: 'benjamin', attempt: 2 })
  })

  it('merkt sich die Anmeldung auf Wunsch und nutzt sie beim nächsten Start', () => {
    login.handle(PROXY, vi.fn())
    login.answer('benjamin', 'geheim', true)
    expect(saved.get(KEY)).toEqual({ username: 'benjamin', password: 'geheim' })

    const nextStart = new ProxyLogin({ ask: (p) => (shown.push(p), true), vault, now: () => now })
    const callback = vi.fn()
    nextStart.handle(PROXY, callback)
    expect(callback).toHaveBeenCalledWith('benjamin', 'geheim')
    expect(shown).toHaveLength(2) // nur Abfrage + Schließen vom ersten Mal
  })

  it('fragt nach, wenn die gemerkte Anmeldung nicht mehr stimmt (neues Passwort)', () => {
    saved.set(KEY, { username: 'benjamin', password: 'alt' })
    const callback = vi.fn()
    login.handle(PROXY, callback)
    expect(callback).toHaveBeenCalledWith('benjamin', 'alt')
    now += 100
    login.handle(PROXY, vi.fn())
    expect(prompt()).toMatchObject({ failed: true, username: 'benjamin' })
    login.answer('benjamin', 'neu', true)
    expect(saved.get(KEY)?.password).toBe('neu')
  })

  it('löscht die gemerkte Anmeldung, wenn „Merken“ abgewählt wird', () => {
    saved.set(KEY, { username: 'benjamin', password: 'alt' })
    login.handle(PROXY, vi.fn())
    now += 100
    login.handle(PROXY, vi.fn())
    login.answer('benjamin', 'neu', false)
    expect(saved.has(KEY)).toBe(false)
  })

  it('bricht bei „Abbrechen“ ab und fragt erst bei der nächsten manuellen Suche wieder', () => {
    const callback = vi.fn()
    login.handle(PROXY, callback)
    login.cancel()
    expect(callback).toHaveBeenCalledWith()
    expect(prompt()).toBeNull()

    // Automatische Prüfung im Hintergrund: keine neue Abfrage
    const background = vi.fn()
    login.handle(PROXY, background)
    expect(background).toHaveBeenCalledWith()
    expect(shown).toHaveLength(2)

    // „Nach Updates suchen“: wieder fragen
    login.allowPrompt()
    login.handle(PROXY, vi.fn())
    expect(prompt()).toMatchObject({ host: KEY, attempt: 2 })
  })

  it('bricht ab, wenn kein Fenster da ist, und ignoriert Anmeldungen an Webseiten', () => {
    windowOpen = false
    const callback = vi.fn()
    login.handle(PROXY, callback)
    expect(callback).toHaveBeenCalledWith()
    expect(login.current()).toBeNull()

    const site = vi.fn()
    login.handle({ ...PROXY, isProxy: false }, site)
    expect(site).toHaveBeenCalledWith()
  })

  it('vergisst gespeicherte Anmeldungen', () => {
    login.handle(PROXY, vi.fn())
    login.answer('benjamin', 'geheim', true)
    login.forget([KEY])
    expect(saved.size).toBe(0)
    now += REJECTED_WITHIN_MS * 2
    login.handle(PROXY, vi.fn())
    expect(prompt()).toMatchObject({ failed: false, attempt: 2 })
  })

  it('bietet „Merken“ nur an, wenn verschlüsselt werden kann', () => {
    vault.canRemember = () => false
    login.handle(PROXY, vi.fn())
    expect(prompt()?.canRemember).toBe(false)
    login.answer('benjamin', 'geheim', true)
    expect(saved.size).toBe(0)
  })
})

describe('Fehlermeldungen der Update-Prüfung', () => {
  it('erklärt Proxy-Probleme verständlich', () => {
    expect(explainUpdateError(new Error('HTTP 407'))).toMatch(/Benutzername und Passwort für den Proxy/)
    expect(explainUpdateError(new Error('net::ERR_PROXY_CONNECTION_FAILED'))).toMatch(/Proxy-Server ist nicht erreichbar/)
    expect(explainUpdateError(new Error('net::ERR_TUNNEL_CONNECTION_FAILED'))).toMatch(/github\.com und githubusercontent\.com/)
    expect(explainUpdateError(new Error('net::ERR_CERT_AUTHORITY_INVALID'))).toMatch(/Zertifikat/)
    expect(explainUpdateError(new Error('GitHub rate limit'))).toMatch(/in einer Stunde/)
    expect(explainUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toMatch(/nicht erreichbar/)
    expect(explainUpdateError(new Error('HttpError: 404 Not Found'))).toMatch(/öffentlich/)
  })
})
