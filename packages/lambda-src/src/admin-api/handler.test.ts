import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listUsersMock = vi.fn()
const getUserMock = vi.fn()
const setUserEnabledMock = vi.fn()
const listRolesMock = vi.fn()
const assignRoleMock = vi.fn()
const revokeRoleMock = vi.fn()

vi.mock('./handlers/listUsers', () => ({ listUsers: listUsersMock }))
vi.mock('./handlers/getUser', () => ({
  getUser: getUserMock,
  NotFoundError: class NotFoundError extends Error {},
}))
vi.mock('./handlers/setUserEnabled', () => ({ setUserEnabled: setUserEnabledMock }))
vi.mock('./handlers/listRoles', () => ({ listRoles: listRolesMock }))
vi.mock('./handlers/assignRole', () => ({ assignRole: assignRoleMock }))
vi.mock('./handlers/revokeRole', () => ({ revokeRole: revokeRoleMock }))
vi.mock('../shared/ddb-client', () => ({ getDdbDocClient: () => ({}) }))
vi.mock('../shared/cognito-client', () => ({ getCognitoClient: () => ({}) }))

const { handler } = await import('./handler')
const { ForbiddenError } = await import('./authz')

const baseEnv = {
  ROLE_ASSIGNMENTS_TABLE_NAME: 'role-assignments-table',
  ROLES_TABLE_NAME: 'roles-table',
  USER_POOL_ID: 'us-east-1_example',
}

function buildEvent(
  overrides: Partial<APIGatewayProxyEventV2WithJWTAuthorizer>,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: 'GET /users',
    rawPath: '/users',
    rawQueryString: '',
    headers: {},
    requestContext: {
      authorizer: {
        jwt: {
          claims: { tenantId: 'acme-corp', permissions: 'admin:users:read:own' },
          scopes: [],
        },
      },
    },
    pathParameters: {},
    isBase64Encoded: false,
    ...overrides,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
}

beforeEach(() => {
  process.env = { ...baseEnv }
  listUsersMock.mockReset()
  getUserMock.mockReset()
  setUserEnabledMock.mockReset()
  listRolesMock.mockReset()
  assignRoleMock.mockReset()
  revokeRoleMock.mockReset()
})

describe('admin-api handler', () => {
  it('routes GET /users to listUsers and returns 200 with the result as JSON', async () => {
    listUsersMock.mockResolvedValue({ users: [{ userId: 'user-1' }] })

    const result = await handler(buildEvent({ routeKey: 'GET /users' }))

    expect(listUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        caller: { tenantId: 'acme-corp', privileges: ['admin:users:read:own'] },
      }),
    )
    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body as string)).toEqual({ users: [{ userId: 'user-1' }] })
  })

  it('routes GET /users/{userId} to getUser with the path parameter', async () => {
    getUserMock.mockResolvedValue({ userId: 'user-1' })

    await handler(
      buildEvent({ routeKey: 'GET /users/{userId}', pathParameters: { userId: 'user-1' } }),
    )

    expect(getUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetUserId: 'user-1' }),
    )
  })

  it('routes PATCH /users/{userId}/enabled to setUserEnabled with the parsed body', async () => {
    setUserEnabledMock.mockResolvedValue(undefined)

    const result = await handler(
      buildEvent({
        routeKey: 'PATCH /users/{userId}/enabled',
        pathParameters: { userId: 'user-1' },
        body: JSON.stringify({ enabled: false }),
      }),
    )

    expect(setUserEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetUserId: 'user-1', enabled: false }),
    )
    expect(result.statusCode).toBe(204)
  })

  it('routes GET /roles to listRoles', async () => {
    listRolesMock.mockResolvedValue({ roles: [] })

    const result = await handler(buildEvent({ routeKey: 'GET /roles' }))

    expect(listRolesMock).toHaveBeenCalled()
    expect(result.statusCode).toBe(200)
  })

  it('routes PUT /users/{userId}/roles/{roleId} to assignRole with the path params', async () => {
    assignRoleMock.mockResolvedValue(undefined)

    const result = await handler(
      buildEvent({
        routeKey: 'PUT /users/{userId}/roles/{roleId}',
        pathParameters: { userId: 'user-1', roleId: 'tenant-admin' },
      }),
    )

    expect(assignRoleMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetUserId: 'user-1', roleId: 'tenant-admin' }),
    )
    expect(result.statusCode).toBe(204)
  })

  it('routes DELETE /users/{userId}/roles/{roleId} to revokeRole with the path params', async () => {
    revokeRoleMock.mockResolvedValue(undefined)

    const result = await handler(
      buildEvent({
        routeKey: 'DELETE /users/{userId}/roles/{roleId}',
        pathParameters: { userId: 'user-1', roleId: 'billing' },
      }),
    )

    expect(revokeRoleMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetUserId: 'user-1', roleId: 'billing' }),
    )
    expect(result.statusCode).toBe(204)
  })

  it('maps a ForbiddenError from a handler to a 403 response', async () => {
    listUsersMock.mockRejectedValue(new ForbiddenError('nope'))

    const result = await handler(buildEvent({ routeKey: 'GET /users' }))

    expect(result.statusCode).toBe(403)
  })

  it('returns 404 for an unrecognized route', async () => {
    const result = await handler(buildEvent({ routeKey: 'GET /nonexistent' }))
    expect(result.statusCode).toBe(404)
  })
})
