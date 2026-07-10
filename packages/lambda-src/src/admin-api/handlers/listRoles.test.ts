import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenError } from '../authz'
import { listRoles } from './listRoles'

const ddbMock = mockClient(DynamoDBDocumentClient)

beforeEach(() => {
  ddbMock.reset()
})

describe('listRoles', () => {
  it('returns the seeded role catalog for an authorized caller', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { roleId: 'member', privileges: [], tenantScope: 'tenant' },
        { roleId: 'admin', privileges: ['admin:users:read:own'], tenantScope: 'tenant' },
      ],
    })

    const result = await listRoles({
      caller: { tenantId: 'acme-corp', privileges: ['admin:roles:read'] },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      rolesTableName: 'roles-table',
    })

    expect(result.roles).toEqual([
      { roleId: 'member', privileges: [], tenantScope: 'tenant' },
      { roleId: 'admin', privileges: ['admin:users:read:own'], tenantScope: 'tenant' },
    ])
  })

  it('rejects a caller without the admin:roles:read privilege', async () => {
    await expect(
      listRoles({
        caller: { tenantId: 'acme-corp', privileges: [] },
        ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
        rolesTableName: 'roles-table',
      }),
    ).rejects.toThrow(ForbiddenError)

    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0)
  })
})
