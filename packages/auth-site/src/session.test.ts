import { describe, it, expect, beforeEach } from 'vitest'
import { saveSession, loadSession, clearSession, isSessionExpired } from './session'

beforeEach(() => {
  sessionStorage.clear()
})

describe('saveSession / loadSession', () => {
  it('round-trips the session marker through sessionStorage', () => {
    const marker = { expiresAt: Date.now() + 3600_000 }
    saveSession(marker)
    expect(loadSession()).toEqual(marker)
  })

  it('returns null when nothing is stored', () => {
    expect(loadSession()).toBeNull()
  })

  it('returns null for corrupt data', () => {
    sessionStorage.setItem('auth_session', 'not-json')
    expect(loadSession()).toBeNull()
  })

  it('returns null when the stored value lacks a numeric expiresAt', () => {
    sessionStorage.setItem('auth_session', JSON.stringify({ nope: true }))
    expect(loadSession()).toBeNull()
  })
})

describe('clearSession', () => {
  it('removes the stored marker', () => {
    saveSession({ expiresAt: Date.now() + 3600_000 })
    clearSession()
    expect(loadSession()).toBeNull()
  })
})

describe('isSessionExpired', () => {
  it('returns false for a future expiresAt', () => {
    expect(isSessionExpired({ expiresAt: Date.now() + 60_000 })).toBe(false)
  })

  it('returns true for a past expiresAt', () => {
    expect(isSessionExpired({ expiresAt: Date.now() - 1 })).toBe(true)
  })
})
