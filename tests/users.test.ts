import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { hashPassword, verifyPassword } from '../src/main/passwords'
import { WikiError, WikiStore } from '../src/main/store'

let store: WikiStore

beforeEach(() => {
  store = new WikiStore(openDatabase(':memory:', 'Team'), 'admin')
})

describe('Passwörter', () => {
  it('speichert nur Hashes mit Salz', () => {
    const a = hashPassword('geheim')
    const b = hashPassword('geheim')
    expect(a).not.toContain('geheim')
    expect(a).not.toBe(b)
    expect(verifyPassword('geheim', a)).toBe(true)
    expect(verifyPassword('falsch', a)).toBe(false)
    expect(verifyPassword('geheim', 'kaputt')).toBe(false)
  })
})

describe('Benutzer', () => {
  it('legt beim ersten Öffnen den Admin mit dem Passwort „admin“ an', () => {
    expect(store.listUsers()).toEqual([expect.objectContaining({ username: 'admin', role: 'admin', deleted: false })])
    expect(store.verifyLogin('admin', 'admin')).toMatchObject({ username: 'admin', role: 'admin' })
    expect(store.verifyLogin('ADMIN', 'admin')).not.toBeNull()
    expect(store.verifyLogin('admin', 'falsch')).toBeNull()
    expect(store.adminHasDefaultPassword()).toBe(true)
    expect(store.onlyAdmin()).toBe(true)
  })

  it('verwaltet Mitarbeiter und Bearbeiter', () => {
    const anna = store.createUser('Anna', 'pass1', 'editor')
    const ben = store.createUser(' Ben ', 'pass2', 'author')
    expect(store.onlyAdmin()).toBe(false)
    expect(store.verifyLogin('ben', 'pass2')).toMatchObject({ username: 'Ben', role: 'author' })
    expect(() => store.createUser('anna', 'xxxx', 'author')).toThrow(/gibt es schon/)
    expect(() => store.createUser('a', 'xxxx', 'author')).toThrow(WikiError)
    expect(() => store.createUser('Leer Zeichen', 'xxxx', 'author')).toThrow(WikiError)
    expect(() => store.createUser('Chef', 'xxxx', 'admin')).toThrow(/Rolle/)
    expect(() => store.createUser('Kurz', 'abc', 'author')).toThrow(/mindestens 4/)

    store.setUserRole(ben, 'editor')
    expect(store.verifyLogin('Ben', 'pass2')?.role).toBe('editor')
    store.resetPassword(anna, 'neu-1')
    expect(store.verifyLogin('Anna', 'pass1')).toBeNull()
    expect(store.verifyLogin('Anna', 'neu-1')).not.toBeNull()

    store.changeOwnPassword('admin', 'admin', 'sicher!')
    expect(store.adminHasDefaultPassword()).toBe(false)
    expect(() => store.changeOwnPassword('admin', 'falsch', 'xyz1')).toThrow(/stimmt nicht/)
  })

  it('schützt den Admin', () => {
    const admin = store.listUsers()[0].id
    expect(() => store.deleteUser(admin)).toThrow(/Admin/)
    expect(() => store.setUserRole(admin, 'author')).toThrow(/Admin/)
  })

  it('kennzeichnet Artikel gelöschter Benutzer und sperrt deren Anmeldung', () => {
    const ben = store.createUser('Ben', 'pass', 'author')
    store.author = 'Ben'
    const a = store.createArticle(store.rootId(), 'Von Ben')
    store.author = 'admin'
    store.deleteUser(ben)
    expect(store.verifyLogin('Ben', 'pass')).toBeNull()
    const tree = store.getTree()
    expect(tree.deletedUsers).toEqual(['Ben'])
    expect(tree.articles.find((x) => x.id === a)).toMatchObject({ title: 'Von Ben', createdBy: 'Ben' })
    expect(store.listUsers().find((u) => u.id === ben)).toMatchObject({ deleted: true })
    // Der Name bleibt vergeben, damit die Kennzeichnung eindeutig bleibt
    expect(() => store.createUser('ben', 'pass', 'author')).toThrow(/gelöschten Benutzer/)
  })
})
