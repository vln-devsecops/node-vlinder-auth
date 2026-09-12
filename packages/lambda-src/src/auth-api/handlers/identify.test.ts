import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { UnknownClientError, UnregisteredRedirectUriError } from '../../shared/tenants'
import { verifySession } from '../session'
import { identify, IncompleteRpHandoffContextError, InvalidIdentifierError } from './identify'

const KEY = 'test-signing-key-000000000000000000000000'
const ddbMock = mockClient(DynamoDBDocumentClient)
const config = { authAppTenantId: 'auth', tenantsTableName: 'tenants-table' }

beforeEach(() => {
  ddbMock.reset()
  ddbMock.on(GetCommand).resolves({})
})

describe('identify', () => {
  it('resolves to local password and issues an identify session carrying the identifier and tenant', async () => {
    const result = await identify({
      identifier: 'jane@example.com',
      clientId: undefined,
      signingKey: KEY,
      config,
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })
    expect(result).toEqual({ method: 'password', tenantId: 'auth', identifySession: expect.any(String) })
    const payload = await verifySession(result.identifySession, KEY)
    expect(payload).toMatchObject({ identifier: 'jane@example.com', method: 'password', tenantId: 'auth' })
  })

  it('trims surrounding whitespace from the identifier', async () => {
    const result = await identify({
      identifier: '  jane@example.com  ',
      clientId: undefined,
      signingKey: KEY,
      config,
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })
    expect(await verifySession(result.identifySession, KEY)).toMatchObject({
      identifier: 'jane@example.com',
    })
  })

  it('rejects an empty identifier', async () => {
    await expect(
      identify({
        identifier: '   ',
        clientId: undefined,
        signingKey: KEY,
        config,
        ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      }),
    ).rejects.toThrow(InvalidIdentifierError)
  })

  it('resolves the tenant from client_id when given', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ tenantId: 'acme-corp' }] })

    const result = await identify({
      identifier: 'jane@acme.com',
      clientId: 'client-abc',
      signingKey: KEY,
      config,
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(result.tenantId).toBe('acme-corp')
  })

  it('rejects an unrecognized client_id', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    await expect(
      identify({
        identifier: 'jane@example.com',
        clientId: 'someone-elses-client',
        signingKey: KEY,
        config,
        ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      }),
    ).rejects.toThrow(UnknownClientError)
  })

  it('resolves to a redirect at /federation when the domain is pinned in the resolved tenant', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ tenantId: 'acme-corp' }] })
    ddbMock.on(GetCommand).resolves({ Item: { identityProviderId: 'okta-acme' } })

    const result = await identify({
      identifier: 'jane@acme.com',
      clientId: 'client-abc',
      signingKey: KEY,
      config,
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(result).toEqual({
      method: 'redirect',
      tenantId: 'acme-corp',
      location: '/federation?provider=okta-acme&action=start',
      identifySession: expect.any(String),
    })
    const payload = await verifySession(result.identifySession, KEY)
    expect(payload).toMatchObject({ method: 'redirect', tenantId: 'acme-corp', provider: 'okta-acme' })
  })

  it('threads redirect_uri, code_challenge and state from an /authorize-originated call into the identify session, after re-validating the redirect_uri', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          tenantId: 'acme-corp',
          clientId: 'client-abc',
          redirectUris: ['https://app.example.com/login/callback'],
        },
      ],
    })

    const result = await identify({
      identifier: 'jane@example.com',
      clientId: 'client-abc',
      signingKey: KEY,
      config,
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      redirectUri: 'https://app.example.com/login/callback',
      codeChallenge: 'test-code-challenge',
      state: 'rp-state-value',
    })

    const payload = await verifySession(result.identifySession, KEY)
    expect(payload).toMatchObject({
      identifier: 'jane@example.com',
      redirectUri: 'https://app.example.com/login/callback',
      codeChallenge: 'test-code-challenge',
      state: 'rp-state-value',
    })
  })

  it('rejects a redirect_uri not registered for the given client_id -- the open-redirect guard also applies here, not just at /authorize', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { tenantId: 'acme-corp', clientId: 'client-abc', redirectUris: ['https://app.example.com/callback'] },
      ],
    })

    await expect(
      identify({
        identifier: 'jane@example.com',
        clientId: 'client-abc',
        signingKey: KEY,
        config,
        ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
        redirectUri: 'https://evil.example.com/phish',
        codeChallenge: 'test-code-challenge',
      }),
    ).rejects.toThrow(UnregisteredRedirectUriError)
  })

  it('rejects a redirect_uri sent with no client_id -- an RP handoff cannot start without one', async () => {
    // The bug this closes: calling /identify directly (skipping /authorize
    // entirely) with a redirect_uri and no client_id used to sail through
    // unchecked, since resolveTenantIdForClient treats an absent client_id
    // as "the auth app's own tenant", not an error -- letting an attacker
    // embed an arbitrary open-redirect target into a signed session that
    // /password would later 302 to.
    await expect(
      identify({
        identifier: 'jane@example.com',
        clientId: undefined,
        signingKey: KEY,
        config,
        ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
        redirectUri: 'https://evil.example.com/phish',
        codeChallenge: 'test-code-challenge',
      }),
    ).rejects.toThrow(IncompleteRpHandoffContextError)
  })

  it('rejects a redirect_uri sent with no code_challenge, without even checking the allowlist', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { tenantId: 'acme-corp', clientId: 'client-abc', redirectUris: ['https://app.example.com/callback'] },
      ],
    })

    // A distinct error class from UnregisteredRedirectUriError -- this
    // request never got far enough to check the allowlist at all (only one
    // QueryCommand call: resolveTenantIdForClient's, not a second one from
    // assertRegisteredRedirectUri), so it must not look like an
    // open-redirect probe in whatever consumes these error types (e.g.
    // alerting).
    await expect(
      identify({
        identifier: 'jane@example.com',
        clientId: 'client-abc',
        signingKey: KEY,
        config,
        ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
        redirectUri: 'https://app.example.com/callback',
      }),
    ).rejects.toThrow(IncompleteRpHandoffContextError)
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(1)
  })
})
