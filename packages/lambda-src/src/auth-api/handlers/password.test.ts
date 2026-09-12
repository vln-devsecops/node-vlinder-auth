import {
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
  NotAuthorizedException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { type OneTimeTokenKey, verifyOneTimeToken } from '../oneTimeToken'
import { signSession } from '../session'
import { AuthFailedError, InvalidSessionError, password, UnverifiedAccountError } from './password'

const KEY = 'test-signing-key-000000000000000000000000'
// Exactly 32 bytes when UTF-8 encoded, as A256GCM's dir mode requires.
const ONE_TIME_TOKEN_KEY_MATERIAL = '01234567890123456789012345678901'.slice(0, 32)
const ONE_TIME_TOKEN_KEY: OneTimeTokenKey = { keyId: 'test-key-id', key: ONE_TIME_TOKEN_KEY_MATERIAL }
const cognitoMock = mockClient(CognitoIdentityProviderClient)
const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  cognitoMock.reset()
  ddbMock.reset()
  // No pending signup-verification row by default -- most tests exercise the
  // ordinary authenticated/challenge/failure paths past this gate.
  ddbMock.on(GetCommand).resolves({})
})

const base = {
  cognitoClient: cognitoMock as unknown as CognitoIdentityProviderClient,
  clientId: 'client-abc',
  userPoolId: 'us-east-1_example',
  signingKeys: [KEY],
  ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
  verificationCodesTableName: 'verification-codes',
  oneTimeTokenKey: ONE_TIME_TOKEN_KEY,
}

function identifySessionFor(
  identifier: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  return signSession({ identifier, method: 'password', ...extra }, KEY, 300)
}

describe('password', () => {
  it('authenticates valid credentials and returns the tokens', async () => {
    const issuedAt = 1_000_000_000_000
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: {
        AccessToken: 'a',
        IdToken: 'i',
        RefreshToken: 'r',
        ExpiresIn: 3600,
      },
    })

    const result = await password({
      ...base,
      identifySession: await identifySessionFor('jane@example.com'),
      password: 'correct horse',
      now: issuedAt,
    })

    expect(result.status).toBe('authenticated')
    if (result.status !== 'authenticated') return
    expect(result.username).toBe('jane@example.com')
    expect(result.tokens).toEqual({
      accessToken: 'a',
      idToken: 'i',
      refreshToken: 'r',
      expiresAt: issuedAt + 3600 * 1000,
    })

    const call = cognitoMock.commandCalls(AdminInitiateAuthCommand)[0]
    expect(call.args[0].input).toMatchObject({
      UserPoolId: 'us-east-1_example',
      ClientId: 'client-abc',
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: 'jane@example.com', PASSWORD: 'correct horse' },
    })
  })

  it('surfaces a Cognito challenge instead of an AS session', async () => {
    cognitoMock
      .on(AdminInitiateAuthCommand)
      .resolves({ ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: 'cognito-session-token' })

    const result = await password({
      ...base,
      identifySession: await identifySessionFor('jane@example.com'),
      password: 'temp',
    })

    expect(result).toEqual({
      status: 'challenge',
      challengeName: 'NEW_PASSWORD_REQUIRED',
      challengeSession: 'cognito-session-token',
    })
  })

  it('rejects a missing or expired identify session', async () => {
    await expect(
      password({ ...base, identifySession: undefined, password: 'x' }),
    ).rejects.toThrow(InvalidSessionError)
    expect(cognitoMock.commandCalls(AdminInitiateAuthCommand)).toHaveLength(0)
  })

  it('verifies an identify session signed with a previous key, when both current and previous are supplied as candidates (rotation boundary)', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: { AccessToken: 'a', IdToken: 'i', RefreshToken: 'r', ExpiresIn: 3600 },
    })
    const previousKey = 'a-previous-signing-key'
    const identifySession = await signSession(
      { identifier: 'jane@example.com', method: 'password' },
      previousKey,
      300,
    )

    const result = await password({
      ...base,
      signingKeys: [KEY, previousKey],
      identifySession,
      password: 'correct horse',
    })

    expect(result.status).toBe('authenticated')
  })

  it('collapses wrong-password and unknown-user into one opaque failure', async () => {
    cognitoMock
      .on(AdminInitiateAuthCommand)
      .rejectsOnce(new NotAuthorizedException({ message: 'nope', $metadata: {} }))
      .rejectsOnce(new UserNotFoundException({ message: 'nope', $metadata: {} }))

    for (let i = 0; i < 2; i++) {
      await expect(
        password({
          ...base,
          identifySession: await identifySessionFor('jane@example.com'),
          password: 'wrong',
        }),
      ).rejects.toThrow(AuthFailedError)
    }
  })

  it('rejects sign-in with a pending signup verification code before touching Cognito', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    ddbMock.on(GetCommand).resolves({
      Item: {
        email: 'jane@example.com',
        purpose: 'signup',
        code: '123456',
        attempts: 0,
        expiresAt: nowSeconds + 600,
      },
    })

    await expect(
      password({
        ...base,
        identifySession: await identifySessionFor('jane@example.com'),
        password: 'correct horse',
      }),
    ).rejects.toThrow(UnverifiedAccountError)
    expect(cognitoMock.commandCalls(AdminInitiateAuthCommand)).toHaveLength(0)
  })

  it('completes the RP handoff with a redirect carrying a one-time token when the identify session carries redirect_uri and code_challenge', async () => {
    const issuedAt = 1_000_000_000_000
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: {
        AccessToken: 'a',
        IdToken: 'i',
        RefreshToken: 'r',
        ExpiresIn: 3600,
      },
    })

    const result = await password({
      ...base,
      identifySession: await identifySessionFor('jane@example.com', {
        redirectUri: 'https://app.example.com/login/callback',
        codeChallenge: 'test-code-challenge',
        state: 'rp-state-value',
      }),
      password: 'correct horse',
      now: issuedAt,
    })

    expect(result.status).toBe('redirect')
    if (result.status !== 'redirect') return
    expect(result.username).toBe('jane@example.com')

    const location = new URL(result.location)
    expect(`${location.origin}${location.pathname}`).toBe('https://app.example.com/login/callback')
    expect(location.searchParams.get('state')).toBe('rp-state-value')

    const token = location.searchParams.get('token')!
    const payload = await verifyOneTimeToken(token, [ONE_TIME_TOKEN_KEY], issuedAt)
    expect(payload).toMatchObject({
      userId: 'jane@example.com',
      redirectUri: 'https://app.example.com/login/callback',
      codeChallenge: 'test-code-challenge',
      tokens: {
        accessToken: 'a',
        idToken: 'i',
        refreshToken: 'r',
        expiresAt: issuedAt + 3600 * 1000,
      },
    })
  })

  it('omits the state param entirely when the identify session carries no state', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: { AccessToken: 'a', IdToken: 'i', RefreshToken: 'r', ExpiresIn: 3600 },
    })

    const result = await password({
      ...base,
      identifySession: await identifySessionFor('jane@example.com', {
        redirectUri: 'https://app.example.com/login/callback',
        codeChallenge: 'test-code-challenge',
      }),
      password: 'correct horse',
    })

    expect(result.status).toBe('redirect')
    if (result.status !== 'redirect') return
    expect(result.location).not.toContain('state=')
  })

  it('adds token/state as params rather than corrupting a redirect_uri that already has a query string', async () => {
    // Regression: naive string concatenation (`${redirectUri}?token=...`)
    // produced a second "?" for a redirect_uri like
    // "https://app.example.com/callback?tenant=acme", merging "token" into
    // the "tenant" param's value instead of adding a distinct one.
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: { AccessToken: 'a', IdToken: 'i', RefreshToken: 'r', ExpiresIn: 3600 },
    })

    const result = await password({
      ...base,
      identifySession: await identifySessionFor('jane@example.com', {
        redirectUri: 'https://app.example.com/callback?tenant=acme',
        codeChallenge: 'test-code-challenge',
        state: 'rp-state-value',
      }),
      password: 'correct horse',
    })

    expect(result.status).toBe('redirect')
    if (result.status !== 'redirect') return

    const location = new URL(result.location)
    expect(location.searchParams.get('tenant')).toBe('acme')
    expect(location.searchParams.get('token')).not.toBeNull()
    expect(location.searchParams.get('state')).toBe('rp-state-value')
  })
})
