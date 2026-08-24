import {
  AdminGetUserCommand,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  NotAuthorizedException,
  SignUpCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { mockClient } from 'aws-sdk-client-mock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handler } from './handler'
import { AS_SESSION_COOKIE, IDENTIFY_SESSION_COOKIE, signSession, verifySession } from './session'

const KEY = 'test-signing-key-000000000000000000000000'
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
  secretsManagerMock.on(GetSecretValueCommand).resolves({ SecretString: KEY })
  process.env.SESSION_SIGNING_KEY_SECRET_ID = 'arn:aws:secretsmanager:us-east-1:123:secret:test'
  process.env.AUTH_CLIENT_ID = 'client-abc'
  process.env.USER_POOL_ID = 'us-east-1_example'
  process.env.VERIFICATION_CODES_TABLE_NAME = 'verification-codes-table'
  process.env.VERIFICATION_CODE_TTL_SECONDS = '600'
  process.env.VERIFICATION_CODE_MAX_ATTEMPTS = '5'
  process.env.SES_FROM_ADDRESS = 'no-reply@vlinder.example'
})

afterEach(() => {
  delete process.env.SESSION_SIGNING_KEY_SECRET_ID
  delete process.env.AUTH_CLIENT_ID
  delete process.env.USER_POOL_ID
  delete process.env.VERIFICATION_CODES_TABLE_NAME
  delete process.env.VERIFICATION_CODE_TTL_SECONDS
  delete process.env.VERIFICATION_CODE_MAX_ATTEMPTS
  delete process.env.SES_FROM_ADDRESS
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
    ddbMock.on(GetCommand).resolves({})
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
    ddbMock.on(GetCommand).resolves({})
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

  it('POST /auth/password 401s when a signup verification code is still pending', async () => {
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
      event('POST /auth/password', { body: { password: 'pw' }, cookies: [identifyCookie] }),
    )

    expect(res.statusCode).toBe(401)
    expect(cognitoMock.commandCalls(AdminInitiateAuthCommand)).toHaveLength(0)
  })

  it('POST /auth/signup routes to Cognito SignUp and sends the first verification code', async () => {
    cognitoMock.on(SignUpCommand).resolves({ UserSub: 'sub-1' })
    ddbMock.on(GetCommand).resolves({})
    ddbMock.on(PutCommand).resolves({})
    sesMock.on(SendEmailCommand).resolves({})

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
    expect(sesMock.commandCalls(SendEmailCommand)[0].args[0].input.Destination).toEqual({
      ToAddresses: ['jane@x.com'],
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

  it('POST /auth/confirm validates the code against the table and deletes it', async () => {
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
      event('POST /auth/confirm', { body: { email: 'jane@x.com', code: '123456' } }),
    )

    expect(res.statusCode).toBe(200)
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1)
  })

  it('POST /auth/confirm 400s on a wrong code', async () => {
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
      event('POST /auth/confirm', { body: { email: 'jane@x.com', code: '000000' } }),
    )

    expect(res.statusCode).toBe(400)
  })

  it('POST /auth/resend gets-or-creates a code and re-sends it', async () => {
    ddbMock.on(GetCommand).resolves({})
    ddbMock.on(PutCommand).resolves({})
    sesMock.on(SendEmailCommand).resolves({})

    const res = await handler(event('POST /auth/resend', { body: { email: 'jane@x.com' } }))

    expect(res.statusCode).toBe(200)
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1)
  })

  it('POST /auth/forgot sends a code when the account exists', async () => {
    cognitoMock.on(AdminGetUserCommand).resolves({ Username: 'jane@x.com' })
    ddbMock.on(GetCommand).resolves({})
    ddbMock.on(PutCommand).resolves({})
    sesMock.on(SendEmailCommand).resolves({})

    const res = await handler(event('POST /auth/forgot', { body: { email: 'jane@x.com' } }))

    expect(res.statusCode).toBe(200)
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1)
  })

  it('POST /auth/reset validates the code, then sets the password via AdminSetUserPassword', async () => {
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
      event('POST /auth/reset', {
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

  it('404s an unrecognized route', async () => {
    const res = await handler(event('GET /auth/nope'))
    expect(res.statusCode).toBe(404)
  })
})
