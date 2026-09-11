import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { NotFoundError } from './targetTenant'
import { loadTargetUsersSoleTenant } from './targetTenant'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('loadTargetUsersSoleTenant', () => {
  it('returns the tenant and rows for a user assigned in exactly one tenant', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-1', tenantId: 'acme-corp', roleId: 'member', activation: 'default' },
        { userId: 'user-1', tenantId: 'acme-corp', roleId: 'billing', activation: 'elevated' },
      ],
    })

    const result = await loadTargetUsersSoleTenant(
      ddbMock as unknown as DynamoDBDocumentClient,
      'role-assignments-table',
      'user-1',
    )

    expect(result.tenantId).toBe('acme-corp')
    expect(result.rows).toEqual([
      { userId: 'user-1', tenantId: 'acme-corp', roleId: 'member', activation: 'default' },
      { userId: 'user-1', tenantId: 'acme-corp', roleId: 'billing', activation: 'elevated' },
    ])
  })

  it('throws NotFoundError when the user has no role assignments', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] })

    await expect(
      loadTargetUsersSoleTenant(
        ddbMock as unknown as DynamoDBDocumentClient,
        'role-assignments-table',
        'ghost-user',
      ),
    ).rejects.toThrow(NotFoundError)
  })

  it('throws, rather than silently picking one, when the user holds assignments in more than one tenant', async () => {
    // The data model formally supports this (a user can be logged in on
    // more than one tenant), but no admin-api action has a way to say which
    // of a multi-tenant target's tenants it means -- surface that loudly
    // instead of acting on an arbitrarily-chosen tenant.
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { userId: 'user-1', tenantId: 'acme-corp', roleId: 'member' },
        { userId: 'user-1', tenantId: 'globex', roleId: 'member' },
      ],
    })

    await expect(
      loadTargetUsersSoleTenant(
        ddbMock as unknown as DynamoDBDocumentClient,
        'role-assignments-table',
        'user-1',
      ),
    ).rejects.toThrow(/more than one tenant/)
  })
})
