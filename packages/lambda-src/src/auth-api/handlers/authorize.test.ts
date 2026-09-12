import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { UnknownClientError, UnregisteredRedirectUriError } from '../../shared/tenants'
import {
  authorize,
  InvalidAuthorizeRequestError,
  UnsupportedCodeChallengeMethodError,
  UnsupportedResponseTypeError,
} from './authorize'

const ddbMock = mockClient(DynamoDBDocumentClient)
const config = { authAppTenantId: 'auth', tenantsTableName: 'tenants-table' }

const VALID_PARAMS = {
  clientId: 'client-abc',
  redirectUri: 'https://app.example.com/login/callback',
  responseType: 'code',
  codeChallenge: 'test-challenge',
  codeChallengeMethod: 'S256',
  state: 'rp-state-value',
  config,
  ddbDocClient: undefined as unknown as DynamoDBDocumentClient,
}

beforeEach(() => {
  ddbMock.reset()
  ddbMock.on(QueryCommand).resolves({
    Items: [
      {
        tenantId: 'acme-corp',
        clientId: 'client-abc',
        redirectUris: ['https://app.example.com/login/callback'],
      },
    ],
  })
})

function params(overrides: Partial<typeof VALID_PARAMS> = {}) {
  return { ...VALID_PARAMS, ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient, ...overrides }
}

describe('authorize', () => {
  it('redirects to the SPA root carrying client_id, redirect_uri, code_challenge and state', async () => {
    const result = await authorize(params())

    const location = new URL(result.location, 'https://auth.example.com')
    expect(location.pathname).toBe('/')
    expect(location.searchParams.get('client_id')).toBe('client-abc')
    expect(location.searchParams.get('redirect_uri')).toBe('https://app.example.com/login/callback')
    expect(location.searchParams.get('code_challenge')).toBe('test-challenge')
    expect(location.searchParams.get('state')).toBe('rp-state-value')
  })

  it('rejects an unknown client_id', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    await expect(authorize(params())).rejects.toThrow(UnknownClientError)
  })

  it('rejects a redirect_uri not in the client allowlist', async () => {
    await expect(
      authorize(params({ redirectUri: 'https://evil.example.com/callback' })),
    ).rejects.toThrow(UnregisteredRedirectUriError)
  })

  it('rejects any redirect_uri when the client has an empty allowlist', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ tenantId: 'acme-corp', clientId: 'client-abc' }] })

    await expect(authorize(params())).rejects.toThrow(UnregisteredRedirectUriError)
  })

  it('rejects a response_type other than code', async () => {
    await expect(authorize(params({ responseType: 'token' }))).rejects.toThrow(
      UnsupportedResponseTypeError,
    )
  })

  it('rejects a code_challenge_method other than S256', async () => {
    await expect(authorize(params({ codeChallengeMethod: 'plain' }))).rejects.toThrow(
      UnsupportedCodeChallengeMethodError,
    )
  })

  it('rejects a missing client_id before touching the database', async () => {
    await expect(authorize(params({ clientId: '' }))).rejects.toThrow(InvalidAuthorizeRequestError)
    expect(ddbMock.calls()).toHaveLength(0)
  })

  it('rejects a missing redirect_uri before touching the database', async () => {
    await expect(authorize(params({ redirectUri: '' }))).rejects.toThrow(InvalidAuthorizeRequestError)
    expect(ddbMock.calls()).toHaveLength(0)
  })

  it('rejects a missing code_challenge before touching the database', async () => {
    // The gap this closes: an empty code_challenge would otherwise sail
    // through every other check and only surface later as a confusing
    // silent fallback to the direct-login response at /password.
    await expect(authorize(params({ codeChallenge: '' }))).rejects.toThrow(InvalidAuthorizeRequestError)
    expect(ddbMock.calls()).toHaveLength(0)
  })
})
