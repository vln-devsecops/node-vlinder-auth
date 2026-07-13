import { describe, expect, it } from 'vitest'
import { buildInitiateAuthBody, isMultiTenant, parseAuthResult } from './authConfig'

const clientId = 'test-client-id'

describe('buildInitiateAuthBody', () => {
  it('builds a USER_PASSWORD_AUTH InitiateAuth request body', () => {
    const body = buildInitiateAuthBody(clientId, 'user@example.com', 's3cr3t!')

    expect(body).toEqual({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: clientId,
      AuthParameters: { USERNAME: 'user@example.com', PASSWORD: 's3cr3t!' },
    })
  })
})

describe('parseAuthResult', () => {
  it('extracts tokens from an AuthenticationResult response', () => {
    const now = Date.now()
    const result = {
      AuthenticationResult: {
        AccessToken: 'access-token',
        IdToken: 'id-token',
        RefreshToken: 'refresh-token',
        ExpiresIn: 3600,
      },
    }

    const tokens = parseAuthResult(result)

    expect(tokens.accessToken).toBe('access-token')
    expect(tokens.idToken).toBe('id-token')
    expect(tokens.refreshToken).toBe('refresh-token')
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(now + 3600 * 1000)
  })
})

describe('isMultiTenant', () => {
  it('returns true when passed true', () => {
    expect(isMultiTenant(true)).toBe(true)
  })

  it('returns false when passed false', () => {
    expect(isMultiTenant(false)).toBe(false)
  })
})
