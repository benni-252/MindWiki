import { describe, expect, it } from 'vitest'
import { isNewerVersion } from '../src/shared/version'

describe('Versionsvergleich', () => {
  it('erkennt neuere Versionen', () => {
    expect(isNewerVersion('1.4.0', '1.3.0')).toBe(true)
    expect(isNewerVersion('v1.10.0', '1.9.9')).toBe(true)
    expect(isNewerVersion('2.0.0', '1.99.99')).toBe(true)
    expect(isNewerVersion('1.3.1', '1.3.0')).toBe(true)
  })

  it('meldet gleiche und ältere Versionen nicht', () => {
    expect(isNewerVersion('1.3.0', '1.3.0')).toBe(false)
    expect(isNewerVersion('v1.3.0', '1.3.0')).toBe(false)
    expect(isNewerVersion('1.2.9', '1.3.0')).toBe(false)
    expect(isNewerVersion('kaputt', '1.3.0')).toBe(false)
  })
})
