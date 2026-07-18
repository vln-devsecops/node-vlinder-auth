import {
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
  NotAuthorizedException,
} from '@aws-sdk/client-cognito-identity-provider'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { mockClient } from 'aws-sdk-client-mock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handler } from './handler'
import { IDENTIFY_SESSION_COOKIE, signSession, verifySession } from './session'

const KEY = 'test-signing-key-000000000000000000000000'
const cognitoMock = mockClient(CognitoIdentityProviderClient)

beforeEach(() => {
  cognitoMock.reset()
  process.env.SESSION_SIGNING_KEY = KEY
  process.env.AUTH_CLIENT_ID = 'client-abc'
  process.env.USER_POOL_ID = 'us-east-1_example'
})

afterEach(() => {
  delete process.env.SESSION_SIGNING_KEY
  delete process.env.AUTH_CLIENT_ID
  delete process.env.USER_POOL_ID
})

function event(
  routeKey: string,
  opts: { body?: unknown; cookies?: string[] } = {},
): APIGatewayProxyEventV2 {
  return {
    routeKey,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cookies: opts.cookies,
  } as unknown as APIGatewayProxyEventV2
}

function cookieValue(setCookie: string): string {
  return setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'))
}

describe('auth-api handler', () => {
  it('POST /auth/identify returns method=password and sets the identify cookie', async () => {
    const res = await handler(event('POST /auth/identify', { body: { identifier: 'jane@x.com' } }))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body!)).toEqual({ method: 'password' })
    const setCookie = res.cookies!.find((c) => c.startsWith(IDENTIFY_SESSION_COOKIE))!
    expect(setCookie).toContain('HttpOnly')
    expect(await verifySession(cookieValue(setCookie), KEY)).toMatchObject({
      identifier: 'jane@x.com',
    })
  })

  it('POST /auth/identify 400s on an empty identifier', async () => {
    const res = await handler(event('POST /auth/identify', { body: { identifier: '' } }))
    expect(res.statusCode).toBe(400)
  })

  it('POST /auth/password authenticates and returns the tokens in the body', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: { AccessToken: 'a', IdToken: 'i', RefreshToken: 'r', ExpiresIn: 3600 },
    })
    const token = await signSession({ identifier: 'jane@x.com', method: 'password' }, KEY, 300)
    const identifyCookie = `${IDENTIFY_SESSION_COOKIE}=${token}`

    const res = await handler(
      event('POST /auth/password', { body: { password: 'pw' }, cookies: [identifyCookie] }),
    )

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body!)
    expect(body.tokens).toMatchObject({ accessToken: 'a', idToken: 'i', refreshToken: 'r' })
    expect(typeof body.tokens.expiresAt).toBe('number')
    // No token material as a Set-Cookie in the transitional model.
    expect(res.cookies).toBeUndefined()
  })

  it('POST /auth/password 401s on bad credentials without an AS cookie', async () => {
    cognitoMock
      .on(AdminInitiateAuthCommand)
      .rejects(new NotAuthorizedException({ message: 'no', $metadata: {} }))
    const token = await signSession({ identifier: 'jane@x.com', method: 'password' }, KEY, 300)
    const identifyCookie = `${IDENTIFY_SESSION_COOKIE}=${token}`

    const res = await handler(
      event('POST /auth/password', { body: { password: 'wrong' }, cookies: [identifyCookie] }),
    )

    expect(res.statusCode).toBe(401)
    expect(res.cookies).toBeUndefined()
  })

  it('401s when the password step has no identify cookie', async () => {
    const res = await handler(event('POST /auth/password', { body: { password: 'pw' } }))
    expect(res.statusCode).toBe(401)
  })

  it('404s an unrecognized route', async () => {
    const res = await handler(event('GET /auth/nope'))
    expect(res.statusCode).toBe(404)
  })
})
