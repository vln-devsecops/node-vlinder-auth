import {
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  NotAuthorizedException,
  SignUpCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { mockClient } from 'aws-sdk-client-mock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handler } from './handler'
import { AS_SESSION_COOKIE, IDENTIFY_SESSION_COOKIE, signSession, verifySession } from './session'

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

  it('POST /auth/password sets the token as an HttpOnly cookie and returns only expiresAt', async () => {
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
    // No token material in the body -- only the expiry marker.
    expect(body.tokens).toBeUndefined()
    expect(typeof body.expiresAt).toBe('number')

    const setCookie = res.cookies!.find((c) => c.startsWith(AS_SESSION_COOKIE))!
    expect(cookieValue(setCookie)).toBe('a')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Path=/')
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

  it('POST /auth/signup routes to Cognito SignUp with the name attributes', async () => {
    cognitoMock.on(SignUpCommand).resolves({ UserSub: 'sub-1' })

    const res = await handler(
      event('POST /auth/signup', {
        body: { email: 'jane@x.com', password: 'pw', givenName: 'Jane', familyName: 'Doe' },
      }),
    )

    expect(res.statusCode).toBe(200)
    expect(cognitoMock.commandCalls(SignUpCommand)[0].args[0].input).toMatchObject({
      ClientId: 'client-abc',
      Username: 'jane@x.com',
      UserAttributes: [
        { Name: 'given_name', Value: 'Jane' },
        { Name: 'family_name', Value: 'Doe' },
      ],
    })
  })

  it('maps a self-service Cognito client fault to a 400 with its message', async () => {
    cognitoMock
      .on(SignUpCommand)
      .rejects(new UsernameExistsException({ message: 'User already exists', $metadata: {} }))

    const res = await handler(
      event('POST /auth/signup', {
        body: { email: 'jane@x.com', password: 'pw', givenName: 'Jane', familyName: 'Doe' },
      }),
    )

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body!).error).toBe('User already exists')
  })

  it('POST /auth/reset routes to Cognito ConfirmForgotPassword', async () => {
    cognitoMock.on(ConfirmForgotPasswordCommand).resolves({})

    const res = await handler(
      event('POST /auth/reset', {
        body: { email: 'jane@x.com', code: '123456', newPassword: 'new-pw' },
      }),
    )

    expect(res.statusCode).toBe(200)
    expect(cognitoMock.commandCalls(ConfirmForgotPasswordCommand)[0].args[0].input).toMatchObject({
      Username: 'jane@x.com',
      ConfirmationCode: '123456',
      Password: 'new-pw',
    })
  })

  it('404s an unrecognized route', async () => {
    const res = await handler(event('GET /auth/nope'))
    expect(res.statusCode).toBe(404)
  })
})
