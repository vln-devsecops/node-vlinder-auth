import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { getUserProfile } from './userProfile'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

const base = {
  userId: 'user-123',
  authAppTenantId: 'auth',
  tenantsTableName: 'tenants-table',
}

describe('getUserProfile', () => {
  it('returns an empty object when no profile row exists', async () => {
    ddbMock.on(GetCommand).resolves({})

    const profile = await getUserProfile({
      ...base,
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(profile).toEqual({})
    const call = ddbMock.commandCalls(GetCommand)[0]
    expect(call.args[0].input).toEqual({
      TableName: 'tenants-table',
      Key: { tenantId: 'auth', sk: 'USERPROFILE#user-123' },
    })
  })

  it('returns every field verbatim when the row has all of them', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        tenantId: 'auth',
        sk: 'USERPROFILE#user-123',
        avatarUrl: 'https://example.com/avatar.png',
        displayName: 'Jane Doe',
        preferences: { theme: 'dark' },
      },
    })

    const profile = await getUserProfile({
      ...base,
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(profile).toEqual({
      avatarUrl: 'https://example.com/avatar.png',
      displayName: 'Jane Doe',
      preferences: { theme: 'dark' },
    })
  })

  it('returns only the fields present on a partial profile row', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        tenantId: 'auth',
        sk: 'USERPROFILE#user-123',
        displayName: 'Jane Doe',
      },
    })

    const profile = await getUserProfile({
      ...base,
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
    })

    expect(profile).toEqual({ displayName: 'Jane Doe' })
  })
})
