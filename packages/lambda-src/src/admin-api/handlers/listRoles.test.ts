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
        { roleId: 'admin', privileges: ['read:admin/users'], tenantScope: 'tenant' },
      ],
    })

    const result = await listRoles({
      caller: { tenantId: 'acme-corp', scopes: ['read:admin/roles'] },
      ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
      rolesTableName: 'roles-table',
    })

    expect(result.roles).toEqual([
      { roleId: 'member', privileges: [], tenantScope: 'tenant' },
      { roleId: 'admin', privileges: ['read:admin/users'], tenantScope: 'tenant' },
    ])
  })

  it('rejects a caller without the read:admin/roles privilege', async () => {
    await expect(
      listRoles({
        caller: { tenantId: 'acme-corp', scopes: [] },
        ddbDocClient: ddbMock as unknown as DynamoDBDocumentClient,
        rolesTableName: 'roles-table',
      }),
    ).rejects.toThrow(ForbiddenError)

    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0)
  })
})
