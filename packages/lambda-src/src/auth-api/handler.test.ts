import {
  AdminGetUserCommand,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  NotAuthorizedException,
  SignUpCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider'
import {
  GetSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { mockClient } from 'aws-sdk-client-mock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handler } from './handler'
import type { OneTimeTokenKey } from './oneTimeToken'
import {
  AS_SESSION_COOKIE,
  AUTH_METHOD_COOKIE,
  IDENTIFY_SESSION_COOKIE,
  signSession,
  verifySession,
} from './session'

const KEY = 'test-signing-key-000000000000000000000000'
// Exactly 32 bytes when UTF-8 encoded (32 ASCII characters), as A256GCM's dir
// mode requires -- see oneTimeToken.ts's keyBytes().
const ONE_TIME_TOKEN_KEY_MATERIAL = 'test-one-time-token-key-32-bytes'.slice(0, 32)
const ONE_TIME_TOKEN_KEY: OneTimeTokenKey = {
  keyId: 'version-current',
  key: ONE_TIME_TOKEN_KEY_MATERIAL,
}
// A distinct 32-byte value standing in for the key that was AWSCURRENT
// before the most recent rotation -- used by the rotation-boundary test.
const PREVIOUS_ONE_TIME_TOKEN_KEY_MATERIAL = 'test-previous-one-time-token-key'.slice(0, 32)
const nowSeconds = Math.floor(Date.now() / 1000)
const FUTURE_EXPIRY = nowSeconds + 600

const cognitoMock = mockClient(CognitoIdentityProviderClient)
const secretsManagerMock = mockClient(SecretsManagerClient)
const ddbMock = mockClient(DynamoDBDocumentClient)
const sesMock = mockClient(SESv2Client)

beforeEach(() => {
  cognitoMock.reset()
  secretsManagerMock.reset()
  ddbMock.reset()
  sesMock.reset()
  secretsManagerMock.on(GetSecretValueCommand).callsFake((input) => {
    if (input.SecretId === 'arn:aws:secretsmanager:us-east-1:123:secret:one-time-token') {
      if (input.VersionStage === 'AWSPREVIOUS') {
        return { SecretString: PREVIOUS_ONE_TIME_TOKEN_KEY_MATERIAL, VersionId: 'version-previous' }
      }
      // No VersionStage (getSecret, used elsewhere) or AWSCURRENT both get
      // the current value -- getSecret never passes VersionStage at all.
      return { SecretString: ONE_TIME_TOKEN_KEY_MATERIAL, VersionId: 'version-current' }
    }
    // The session-signing-key secret: /password's getSecretVersions call
    // needs a VersionId even though there's no AWSPREVIOUS in most of these
    // tests (getSecretVersion signals "doesn't exist" via
    // ResourceNotFoundException, not an omitted field -- see below), and
    // /identify's plain getSecret call ignores VersionId entirely, so
    // returning one unconditionally here is harmless for both callers.
    if (input.VersionStage === 'AWSPREVIOUS') {
      throw new ResourceNotFoundException({ message: 'not found', $metadata: {} })
    }
    return { SecretString: KEY, VersionId: 'session-key-version-current' }
  })
  process.env.SESSION_SIGNING_KEY_SECRET_ID = 'arn:aws:secretsmanager:us-east-1:123:secret:test'
  process.env.ONE_TIME_TOKEN_KEY_SECRET_ID = 'arn:aws:secretsmanager:us-east-1:123:secret:one-time-token'
  process.env.AUTH_CLIENT_ID = 'client-abc'
  process.env.USER_POOL_ID = 'us-east-1_example'
  process.env.TENANTS_TABLE_NAME = 'tenants-table'
  process.env.AUTH_APP_TENANT_ID = 'auth'
  process.env.VERIFICATION_CODES_TABLE_NAME = 'verification-codes-table'
  process.env.VERIFICATION_CODE_TTL_SECONDS = '600'
  process.env.VERIFICATION_CODE_MAX_ATTEMPTS = '5'
  process.env.SES_FROM_ADDRESS = 'no-reply@vlinder.example'
})

afterEach(() => {
  delete process.env.SESSION_SIGNING_KEY_SECRET_ID
  delete process.env.ONE_TIME_TOKEN_KEY_SECRET_ID
  delete process.env.AUTH_CLIENT_ID
  delete process.env.USER_POOL_ID
  delete process.env.TENANTS_TABLE_NAME
  delete process.env.AUTH_APP_TENANT_ID
  delete process.env.VERIFICATION_CODES_TABLE_NAME
  delete process.env.VERIFICATION_CODE_TTL_SECONDS
  delete process.env.VERIFICATION_CODE_MAX_ATTEMPTS
  delete process.env.SES_FROM_ADDRESS
})

function event(
  routeKey: string,
  opts: { body?: unknown; cookies?: string[]; queryStringParameters?: Record<string, string> } = {},
): APIGatewayProxyEventV2 {
  return {
    routeKey,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cookies: opts.cookies,
    queryStringParameters: opts.queryStringParameters,
  } as unknown as APIGatewayProxyEventV2
}

function cookieValue(setCookie: string): string {
  return setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'))
}

describe('auth-api handler', () => {
  it('POST /api/v1/auth/identify returns method=password and sets the identify cookie', async () => {
    ddbMock.on(GetCommand).resolves({})
    const res = await handler(event('POST /api/v1/auth/identify', { body: { identifier: 'jane@x.com' } }))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body!)).toEqual({ method: 'password' })
    const setCookie = res.cookies!.find((c) => c.startsWith(IDENTIFY_SESSION_COOKIE))!
    expect(setCookie).toContain('HttpOnly')
    expect(await verifySession(cookieValue(setCookie), [KEY])).toMatchObject({
      identifier: 'jane@x.com',
      tenantId: 'auth',
    })
  })

  it('POST /api/v1/auth/identify 400s on an empty identifier', async () => {
    const res = await handler(event('POST /api/v1/auth/identify', { body: { identifier: '' } }))
    expect(res.statusCode).toBe(400)
  })

  it('POST /api/v1/auth/identify 400s on an unrecognized client_id', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })
    const res = await handler(
      event('POST /api/v1/auth/identify', { body: { identifier: 'jane@x.com', client_id: 'nope' } }),
    )
    expect(res.statusCode).toBe(400)
  })

  it('POST /api/v1/auth/password sets the token as an HttpOnly cookie and returns only expiresAt', async () => {
    ddbMock.on(GetCommand).resolves({})
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: { AccessToken: 'a', IdToken: 'i', RefreshToken: 'r', ExpiresIn: 3600 },
    })
    const token = await signSession({ identifier: 'jane@x.com', method: 'password' }, KEY, 300)
    const identifyCookie = `${IDENTIFY_SESSION_COOKIE}=${token}`

    const res = await handler(
      event('POST /api/v1/auth/password', { body: { password: 'pw' }, cookies: [identifyCookie] }),
    )

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body!)
    // No token material in the body -- only the expiry marker.
    expect(body.tokens).toBeUndefined()
    expect(typeof body.expiresAt).toBe('number')

    const setCookie = res.cookies!.find((c) => c.startsWith(AS_SESSION_COOKIE))!
    expect(cookieValue(setCookie)).toBe('a')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Path=/')

    const methodCookie = res.cookies!.find((c) => c.startsWith(AUTH_METHOD_COOKIE))!
    expect(cookieValue(methodCookie)).toBe('local')
  })

  it('POST /api/v1/auth/password 401s on bad credentials without an AS cookie', async () => {
    ddbMock.on(GetCommand).resolves({})
    cognitoMock
      .on(AdminInitiateAuthCommand)
      .rejects(new NotAuthorizedException({ message: 'no', $metadata: {} }))
    const token = await signSession({ identifier: 'jane@x.com', method: 'password' }, KEY, 300)
    const identifyCookie = `${IDENTIFY_SESSION_COOKIE}=${token}`

    const res = await handler(
      event('POST /api/v1/auth/password', { body: { password: 'wrong' }, cookies: [identifyCookie] }),
    )

    expect(res.statusCode).toBe(401)
    expect(res.cookies).toBeUndefined()
  })

  it('401s when the password step has no identify cookie', async () => {
    const res = await handler(event('POST /api/v1/auth/password', { body: { password: 'pw' } }))
    expect(res.statusCode).toBe(401)
  })

  it('POST /api/v1/auth/password 401s when a signup verification code is still pending', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        email: 'jane@x.com',
        purpose: 'signup',
        code: '123456',
        attempts: 0,
        expiresAt: FUTURE_EXPIRY,
      },
    })
    const token = await signSession({ identifier: 'jane@x.com', method: 'password' }, KEY, 300)
    const identifyCookie = `${IDENTIFY_SESSION_COOKIE}=${token}`

    const res = await handler(
      event('POST /api/v1/auth/password', { body: { password: 'pw' }, cookies: [identifyCookie] }),
    )

    expect(res.statusCode).toBe(401)
    expect(cognitoMock.commandCalls(AdminInitiateAuthCommand)).toHaveLength(0)
  })

  it('POST /api/v1/auth/signup routes to Cognito SignUp and sends the first verification code', async () => {
    cognitoMock.on(SignUpCommand).resolves({ UserSub: 'sub-1' })
    ddbMock.on(GetCommand).resolves({})
    ddbMock.on(PutCommand).resolves({})
    sesMock.on(SendEmailCommand).resolves({})

    const res = await handler(
      event('POST /api/v1/auth/signup', {
        body: { email: 'jane@x.com', password: 'pw', givenName: 'Jane', familyName: 'Doe' },
      }),
    )

    expect(res.statusCode).toBe(200)
    // Regression: the session-signing key and one-time-token key must not
    // be fetched at all for a route that never uses either -- see
    // shared/secrets.ts's getSecretVersions doc comment on why an eager,
    // every-route prelude fetch would be wasteful specifically for these
    // deliberately-uncached lookups.
    expect(secretsManagerMock.commandCalls(GetSecretValueCommand)).toHaveLength(0)
    expect(cognitoMock.commandCalls(SignUpCommand)[0].args[0].input).toMatchObject({
      ClientId: 'client-abc',
      Username: 'jane@x.com',
      UserAttributes: [
        { Name: 'given_name', Value: 'Jane' },
        { Name: 'family_name', Value: 'Doe' },
      ],
    })
    expect(sesMock.commandCalls(SendEmailCommand)[0].args[0].input.Destination).toEqual({
      ToAddresses: ['jane@x.com'],
    })
  })

  it('maps a self-service Cognito client fault to a 400 with its message', async () => {
    cognitoMock
      .on(SignUpCommand)
      .rejects(new UsernameExistsException({ message: 'User already exists', $metadata: {} }))

    const res = await handler(
      event('POST /api/v1/auth/signup', {
        body: { email: 'jane@x.com', password: 'pw', givenName: 'Jane', familyName: 'Doe' },
      }),
    )

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body!).error).toBe('User already exists')
  })

  it('POST /api/v1/auth/confirm validates the code against the table and deletes it', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        email: 'jane@x.com',
        purpose: 'signup',
        code: '123456',
        attempts: 0,
        expiresAt: FUTURE_EXPIRY,
      },
    })
    ddbMock.on(DeleteCommand).resolves({})

    const res = await handler(
      event('POST /api/v1/auth/confirm', { body: { email: 'jane@x.com', code: '123456' } }),
    )

    expect(res.statusCode).toBe(200)
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1)
  })

  it('POST /api/v1/auth/confirm 400s on a wrong code', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        email: 'jane@x.com',
        purpose: 'signup',
        code: '123456',
        attempts: 0,
        expiresAt: FUTURE_EXPIRY,
      },
    })
    ddbMock.on(UpdateCommand).resolves({})

    const res = await handler(
      event('POST /api/v1/auth/confirm', { body: { email: 'jane@x.com', code: '000000' } }),
    )

    expect(res.statusCode).toBe(400)
  })

  it('POST /api/v1/auth/resend gets-or-creates a code and re-sends it', async () => {
    ddbMock.on(GetCommand).resolves({})
    ddbMock.on(PutCommand).resolves({})
    sesMock.on(SendEmailCommand).resolves({})

    const res = await handler(event('POST /api/v1/auth/resend', { body: { email: 'jane@x.com' } }))

    expect(res.statusCode).toBe(200)
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1)
  })

  it('POST /api/v1/auth/forgot sends a code when the account exists', async () => {
    cognitoMock.on(AdminGetUserCommand).resolves({ Username: 'jane@x.com' })
    ddbMock.on(GetCommand).resolves({})
    ddbMock.on(PutCommand).resolves({})
    sesMock.on(SendEmailCommand).resolves({})

    const res = await handler(event('POST /api/v1/auth/forgot', { body: { email: 'jane@x.com' } }))

    expect(res.statusCode).toBe(200)
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1)
  })

  it('POST /api/v1/auth/reset validates the code, then sets the password via AdminSetUserPassword', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        email: 'jane@x.com',
        purpose: 'password-reset',
        code: '123456',
        attempts: 0,
        expiresAt: FUTURE_EXPIRY,
      },
    })
    cognitoMock.on(AdminSetUserPasswordCommand).resolves({})

    const res = await handler(
      event('POST /api/v1/auth/reset', {
        body: { email: 'jane@x.com', code: '123456', newPassword: 'new-pw' },
      }),
    )

    expect(res.statusCode).toBe(200)
    expect(cognitoMock.commandCalls(AdminSetUserPasswordCommand)[0].args[0].input).toMatchObject({
      UserPoolId: 'us-east-1_example',
      Username: 'jane@x.com',
      Password: 'new-pw',
      Permanent: true,
    })
  })

  it('GET /api/v1/auth/authorize redirects to the SPA root on a valid request', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          tenantId: 'acme-corp',
          clientId: 'rp-client',
          redirectUris: ['https://app.example.com/login/callback'],
        },
      ],
    })

    const res = await handler(
      event('GET /api/v1/auth/authorize', {
        queryStringParameters: {
          client_id: 'rp-client',
          redirect_uri: 'https://app.example.com/login/callback',
          response_type: 'code',
          code_challenge: 'test-challenge',
          code_challenge_method: 'S256',
          state: 'rp-state',
        },
      }),
    )

    expect(res.statusCode).toBe(302)
    const location = new URL(res.headers!.location as string, 'https://auth.example.com')
    expect(location.pathname).toBe('/')
    expect(location.searchParams.get('client_id')).toBe('rp-client')
    // /authorize needs neither the session-signing key nor the one-time-
    // token key -- same regression this route class should never trip.
    expect(secretsManagerMock.commandCalls(GetSecretValueCommand)).toHaveLength(0)
  })

  it('GET /api/v1/auth/authorize omits the state param entirely when the RP did not send one', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          tenantId: 'acme-corp',
          clientId: 'rp-client',
          redirectUris: ['https://app.example.com/login/callback'],
        },
      ],
    })

    const res = await handler(
      event('GET /api/v1/auth/authorize', {
        queryStringParameters: {
          client_id: 'rp-client',
          redirect_uri: 'https://app.example.com/login/callback',
          response_type: 'code',
          code_challenge: 'test-challenge',
          code_challenge_method: 'S256',
        },
      }),
    )

    const location = new URL(res.headers!.location as string, 'https://auth.example.com')
    expect(location.searchParams.has('state')).toBe(false)
  })

  it('GET /api/v1/auth/authorize 400s on a redirect_uri outside the client allowlist', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ tenantId: 'acme-corp', clientId: 'rp-client', redirectUris: ['https://app.example.com/callback'] }],
    })

    const res = await handler(
      event('GET /api/v1/auth/authorize', {
        queryStringParameters: {
          client_id: 'rp-client',
          redirect_uri: 'https://evil.example.com/callback',
          response_type: 'code',
          code_challenge: 'test-challenge',
          code_challenge_method: 'S256',
          state: 'rp-state',
        },
      }),
    )

    expect(res.statusCode).toBe(400)
  })

  it('GET /api/v1/auth/authorize 400s on a missing code_challenge, not a 500', async () => {
    // Regression: InvalidAuthorizeRequestError wasn't mapped in
    // errorResponse(), so this used to fall through to `throw error` and
    // surface as an unhandled 500 instead of the intended 400.
    const res = await handler(
      event('GET /api/v1/auth/authorize', {
        queryStringParameters: {
          client_id: 'rp-client',
          redirect_uri: 'https://app.example.com/login/callback',
          response_type: 'code',
          code_challenge: '',
          code_challenge_method: 'S256',
          state: 'rp-state',
        },
      }),
    )

    expect(res.statusCode).toBe(400)
  })

  it('POST /api/v1/auth/token exchanges a valid one-time token and code_verifier for the embedded tokens', async () => {
    const { createHash } = await import('node:crypto')
    const { mintOneTimeToken } = await import('./oneTimeToken')
    const codeVerifier = 'a-known-code-verifier-string'
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const token = await mintOneTimeToken(
      {
        userId: 'jane@x.com',
        redirectUri: 'https://app.example.com/login/callback',
        codeChallenge,
        tokens: { accessToken: 'a', idToken: 'i', refreshToken: 'r', expiresAt: 123 },
      },
      ONE_TIME_TOKEN_KEY,
      60,
    )

    const res = await handler(
      event('POST /api/v1/auth/token', { body: { token, code_verifier: codeVerifier } }),
    )

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body!)).toEqual({
      accessToken: 'a',
      idToken: 'i',
      refreshToken: 'r',
      expiresAt: 123,
    })
  })

  it('POST /api/v1/auth/token 400s on a mismatched code_verifier', async () => {
    const { createHash } = await import('node:crypto')
    const { mintOneTimeToken } = await import('./oneTimeToken')
    const codeChallenge = createHash('sha256').update('the-real-verifier').digest('base64url')
    const token = await mintOneTimeToken(
      {
        userId: 'jane@x.com',
        redirectUri: 'https://app.example.com/login/callback',
        codeChallenge,
        tokens: { accessToken: 'a', idToken: 'i', refreshToken: 'r', expiresAt: 123 },
      },
      ONE_TIME_TOKEN_KEY,
      60,
    )

    const res = await handler(
      event('POST /api/v1/auth/token', { body: { token, code_verifier: 'wrong-verifier' } }),
    )

    expect(res.statusCode).toBe(400)
  })

  it('POST /api/v1/auth/token still exchanges a token minted with the AWSPREVIOUS key (rotation boundary)', async () => {
    // Simulates the exact race the fix targets: this token was minted while
    // the now-AWSPREVIOUS key was still AWSCURRENT, and is being exchanged
    // after a rotation has since replaced AWSCURRENT.
    const { createHash } = await import('node:crypto')
    const { mintOneTimeToken } = await import('./oneTimeToken')
    const codeVerifier = 'a-known-code-verifier-string'
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const token = await mintOneTimeToken(
      {
        userId: 'jane@x.com',
        redirectUri: 'https://app.example.com/login/callback',
        codeChallenge,
        tokens: { accessToken: 'a', idToken: 'i', refreshToken: 'r', expiresAt: 123 },
      },
      { keyId: 'version-previous', key: PREVIOUS_ONE_TIME_TOKEN_KEY_MATERIAL },
      60,
    )

    const res = await handler(
      event('POST /api/v1/auth/token', { body: { token, code_verifier: codeVerifier } }),
    )

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body!)).toEqual({
      accessToken: 'a',
      idToken: 'i',
      refreshToken: 'r',
      expiresAt: 123,
    })
  })

  it('POST /api/v1/auth/token still works with only a current key when Secrets Manager has no AWSPREVIOUS yet (a fresh, never-rotated deployment)', async () => {
    secretsManagerMock.reset()
    secretsManagerMock.on(GetSecretValueCommand).callsFake((input) => {
      if (input.VersionStage === 'AWSPREVIOUS') {
        throw new ResourceNotFoundException({ message: 'not found', $metadata: {} })
      }
      if (input.SecretId === 'arn:aws:secretsmanager:us-east-1:123:secret:one-time-token') {
        return { SecretString: ONE_TIME_TOKEN_KEY_MATERIAL, VersionId: 'version-current' }
      }
      return { SecretString: KEY, VersionId: 'session-key-version-current' }
    })

    const { createHash } = await import('node:crypto')
    const { mintOneTimeToken } = await import('./oneTimeToken')
    const codeVerifier = 'a-known-code-verifier-string'
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const token = await mintOneTimeToken(
      {
        userId: 'jane@x.com',
        redirectUri: 'https://app.example.com/login/callback',
        codeChallenge,
        tokens: { accessToken: 'a', idToken: 'i', refreshToken: 'r', expiresAt: 123 },
      },
      ONE_TIME_TOKEN_KEY,
      60,
    )

    const res = await handler(
      event('POST /api/v1/auth/token', { body: { token, code_verifier: codeVerifier } }),
    )

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body!)).toEqual({
      accessToken: 'a',
      idToken: 'i',
      refreshToken: 'r',
      expiresAt: 123,
    })
  })

  it('POST /api/v1/auth/password still mints a working one-time token when Secrets Manager has no AWSPREVIOUS yet', async () => {
    secretsManagerMock.reset()
    secretsManagerMock.on(GetSecretValueCommand).callsFake((input) => {
      if (input.VersionStage === 'AWSPREVIOUS') {
        throw new ResourceNotFoundException({ message: 'not found', $metadata: {} })
      }
      if (input.SecretId === 'arn:aws:secretsmanager:us-east-1:123:secret:one-time-token') {
        return { SecretString: ONE_TIME_TOKEN_KEY_MATERIAL, VersionId: 'version-current' }
      }
      return { SecretString: KEY, VersionId: 'session-key-version-current' }
    })
    ddbMock.on(GetCommand).resolves({})
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: { AccessToken: 'a', IdToken: 'i', RefreshToken: 'r', ExpiresIn: 3600 },
    })
    const identifyToken = await signSession(
      {
        identifier: 'jane@x.com',
        method: 'password',
        redirectUri: 'https://app.example.com/login/callback',
        codeChallenge: 'test-code-challenge',
        state: 'rp-state',
      },
      KEY,
      300,
    )

    const res = await handler(
      event('POST /api/v1/auth/password', {
        body: { password: 'pw' },
        cookies: [`${IDENTIFY_SESSION_COOKIE}=${identifyToken}`],
      }),
    )

    expect(res.statusCode).toBe(302)
    expect(res.headers!.location).toContain('https://app.example.com/login/callback?token=')
  })

  it('POST /api/v1/auth/password sets AUTH_METHOD_COOKIE=local and 302s to the RP when the identify session carries redirect_uri and code_challenge', async () => {
    ddbMock.on(GetCommand).resolves({})
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: { AccessToken: 'a', IdToken: 'i', RefreshToken: 'r', ExpiresIn: 3600 },
    })
    const token = await signSession(
      {
        identifier: 'jane@x.com',
        method: 'password',
        redirectUri: 'https://app.example.com/login/callback',
        codeChallenge: 'test-code-challenge',
        state: 'rp-state',
      },
      KEY,
      300,
    )
    const identifyCookie = `${IDENTIFY_SESSION_COOKIE}=${token}`

    const res = await handler(
      event('POST /api/v1/auth/password', { body: { password: 'pw' }, cookies: [identifyCookie] }),
    )

    expect(res.statusCode).toBe(302)
    expect(res.headers!.location).toContain('https://app.example.com/login/callback?token=')

    const methodCookie = res.cookies!.find((c) => c.startsWith(AUTH_METHOD_COOKIE))!
    expect(cookieValue(methodCookie)).toBe('local')
    const sessionCookie = res.cookies!.find((c) => c.startsWith(AS_SESSION_COOKIE))!
    expect(cookieValue(sessionCookie)).toBe('a')
  })

  it('404s an unrecognized route', async () => {
    const res = await handler(event('GET /api/v1/auth/nope'))
    expect(res.statusCode).toBe(404)
  })
})
