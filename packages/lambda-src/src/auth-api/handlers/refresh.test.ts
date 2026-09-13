import {
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
  NotAuthorizedException,
} from '@aws-sdk/client-cognito-identity-provider'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { mintRefreshToken, type RefreshTokenKey, verifyRefreshToken } from '../refreshToken'
import { InvalidRefreshTokenError, refresh } from './refresh'

// Exactly 32 bytes when UTF-8 encoded, as A256GCM's dir mode requires.
const CURRENT_KEY: RefreshTokenKey = {
  keyId: 'current-key-id',
  key: '01234567890123456789012345678901'.slice(0, 32),
}
const PREVIOUS_KEY: RefreshTokenKey = {
  keyId: 'previous-key-id',
  key: '99999999999999999999999999999999'.slice(0, 32),
}

const cognitoMock = mockClient(CognitoIdentityProviderClient)

beforeEach(() => {
  cognitoMock.reset()
})

const base = {
  cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
  clientId: 'client-abc',
  userPoolId: 'us-east-1_example',
  verifyKeys: [CURRENT_KEY],
  mintKey: CURRENT_KEY,
  refreshTokenTtlSeconds: 2_592_000,
}

function refreshTokenFor(
  cognitoRefreshToken: string,
  elevatedGrants: { privilege: string; expiresAt: number }[] = [],
  key: RefreshTokenKey = CURRENT_KEY,
) {
  return mintRefreshToken({ cognitoRefreshToken, elevatedGrants }, key, 2_592_000)
}

describe('refresh', () => {
  it('exchanges a valid refresh JWE for fresh tokens and returns a newly-rotated JWE', async () => {
    const issuedAt = 1_000_000_000_000
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: {
        AccessToken: 'new-access',
        IdToken: 'new-id',
        RefreshToken: 'new-cognito-refresh-token',
        ExpiresIn: 3600,
      },
    })
    const incoming = await refreshTokenFor('old-cognito-refresh-token')

    const result = await refresh({ ...base, refreshToken: incoming, now: issuedAt })

    expect(result.accessToken).toBe('new-access')
    expect(result.idToken).toBe('new-id')
    expect(result.expiresAt).toBe(issuedAt + 3600 * 1000)
    expect(result.refreshToken).not.toBe(incoming)

    const call = cognitoMock.commandCalls(AdminInitiateAuthCommand)[0]
    expect(call.args[0].input).toEqual({
      UserPoolId: 'us-east-1_example',
      ClientId: 'client-abc',
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: { REFRESH_TOKEN: 'old-cognito-refresh-token' },
    })

    const decrypted = await verifyRefreshToken(result.refreshToken, [CURRENT_KEY], issuedAt)
    expect(decrypted).toMatchObject({
      cognitoRefreshToken: 'new-cognito-refresh-token',
      elevatedGrants: [],
    })
  })

  it('drops an expired elevated grant and keeps a live one across rotation', async () => {
    const now = 1_000_000_000_000
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: {
        AccessToken: 'new-access',
        IdToken: 'new-id',
        RefreshToken: 'new-cognito-refresh-token',
        ExpiresIn: 3600,
      },
    })
    const liveGrant = { privilege: 'refund:acme:orders/**', expiresAt: now + 60_000 }
    const expiredGrant = { privilege: 'admin:acme:users/**', expiresAt: now - 60_000 }
    const incoming = await refreshTokenFor('old-cognito-refresh-token', [liveGrant, expiredGrant])

    const result = await refresh({ ...base, refreshToken: incoming, now })

    const decrypted = await verifyRefreshToken(result.refreshToken, [CURRENT_KEY], now)
    expect(decrypted?.elevatedGrants).toEqual([liveGrant])
  })

  it('throws InvalidRefreshTokenError on a tampered/invalid JWE without ever calling Cognito', async () => {
    const incoming = await refreshTokenFor('old-cognito-refresh-token')
    const parts = incoming.split('.')
    const ciphertext = parts[3]
    const tamperedCiphertext = (ciphertext[0] === 'A' ? 'B' : 'A') + ciphertext.slice(1)
    const tampered = [parts[0], parts[1], parts[2], tamperedCiphertext, parts[4]].join('.')

    await expect(refresh({ ...base, refreshToken: tampered })).rejects.toThrow(InvalidRefreshTokenError)
    expect(cognitoMock.commandCalls(AdminInitiateAuthCommand)).toHaveLength(0)
  })

  it('throws InvalidRefreshTokenError when Cognito rejects the underlying refresh token', async () => {
    cognitoMock
      .on(AdminInitiateAuthCommand)
      .rejects(new NotAuthorizedException({ message: 'Refresh Token has been revoked', $metadata: {} }))
    const incoming = await refreshTokenFor('revoked-cognito-refresh-token')

    await expect(refresh({ ...base, refreshToken: incoming })).rejects.toThrow(InvalidRefreshTokenError)
  })

  it('throws a distinct, clearly-worded error (not InvalidRefreshTokenError) when Cognito omits RefreshToken (rotation not enabled)', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: {
        AccessToken: 'new-access',
        IdToken: 'new-id',
        ExpiresIn: 3600,
        // RefreshToken deliberately absent.
      },
    })
    const incoming = await refreshTokenFor('old-cognito-refresh-token')

    let caught: unknown
    try {
      await refresh({ ...base, refreshToken: incoming })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught).not.toBeInstanceOf(InvalidRefreshTokenError)
    expect((caught as Error).message).toMatch(/rotated refresh token/)
  })

  it('throws a plain Error (not InvalidRefreshTokenError) when Cognito omits AccessToken/IdToken', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: { RefreshToken: 'new-cognito-refresh-token', ExpiresIn: 3600 },
    })
    const incoming = await refreshTokenFor('old-cognito-refresh-token')

    let caught: unknown
    try {
      await refresh({ ...base, refreshToken: incoming })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught).not.toBeInstanceOf(InvalidRefreshTokenError)
  })

  it('succeeds when the incoming JWE was minted with the previous key (rotation boundary)', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: {
        AccessToken: 'new-access',
        IdToken: 'new-id',
        RefreshToken: 'new-cognito-refresh-token',
        ExpiresIn: 3600,
      },
    })
    const incoming = await refreshTokenFor('old-cognito-refresh-token', [], PREVIOUS_KEY)

    const result = await refresh({
      ...base,
      refreshToken: incoming,
      verifyKeys: [CURRENT_KEY, PREVIOUS_KEY],
    })

    expect(result.accessToken).toBe('new-access')
    // The rotated replacement is always minted with the current key, never
    // the previous one -- confirm it verifies against CURRENT_KEY alone.
    const decrypted = await verifyRefreshToken(result.refreshToken, [CURRENT_KEY])
    expect(decrypted).toMatchObject({ cognitoRefreshToken: 'new-cognito-refresh-token' })
  })
})
