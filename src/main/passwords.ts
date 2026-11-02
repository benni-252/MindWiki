import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// Passwörter werden nur als scrypt-Hash mit zufälligem Salz gespeichert, nie im Klartext.

const KEY_LENGTH = 32

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export const DEFAULT_ADMIN = { username: 'admin', password: 'admin' }
