import { describe, it, expect, beforeEach } from 'vitest'
import type { CognitoTokens } from './authConfig'
import { saveTokens, loadTokens, clearTokens, isTokenExpired } from './session'

const makeTokens = (expiresAt: number): CognitoTokens => ({
  accessToken: 'access',
  idToken: 'id',
  refreshToken: 'refresh',
  expiresAt,
})

beforeEach(() => {
  sessionStorage.clear()
})

describe('saveTokens / loadTokens', () => {
  it('round-trips tokens through sessionStorage', () => {
    const tokens = makeTokens(Date.now() + 3600_000)
    saveTokens(tokens)
    expect(loadTokens()).toEqual(tokens)
  })

  it('returns null when nothing is stored', () => {
    expect(loadTokens()).toBeNull()
  })

  it('returns null for corrupt data', () => {
    sessionStorage.setItem('auth_tokens', 'not-json')
    expect(loadTokens()).toBeNull()
  })
})

describe('clearTokens', () => {
  it('removes stored tokens', () => {
    saveTokens(makeTokens(Date.now() + 3600_000))
    clearTokens()
    expect(loadTokens()).toBeNull()
  })
})

describe('isTokenExpired', () => {
  it('returns false for a future expiresAt', () => {
    expect(isTokenExpired(makeTokens(Date.now() + 60_000))).toBe(false)
  })

  it('returns true for a past expiresAt', () => {
    expect(isTokenExpired(makeTokens(Date.now() - 1))).toBe(true)
  })
})
