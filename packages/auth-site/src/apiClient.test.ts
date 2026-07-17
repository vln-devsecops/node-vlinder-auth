import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminApiClient } from './apiClient'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) }
}

describe('createAdminApiClient', () => {
  it('sends the access token as a Bearer header on every request', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ users: [] }))
    const client = createAdminApiClient({
      baseUrl: 'https://admin-api.example.com',
      getAccessToken: () => 'token-abc',
    })

    await client.listUsers()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://admin-api.example.com/users',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-abc' }),
      }),
    )
  })

  it('returns the users array from GET /users', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ users: [{ userId: 'user-1' }] }))
    const client = createAdminApiClient({
      baseUrl: 'https://admin-api.example.com',
      getAccessToken: () => 'token-abc',
    })

    const users = await client.listUsers()
    expect(users).toEqual([{ userId: 'user-1' }])
  })

  it('sends a PATCH with the enabled flag for setUserEnabled', async () => {
    fetchMock.mockResolvedValue(jsonResponse(undefined, true, 204))
    const client = createAdminApiClient({
      baseUrl: 'https://admin-api.example.com',
      getAccessToken: () => 'token-abc',
    })

    await client.setUserEnabled('user-1', false)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://admin-api.example.com/users/user-1/enabled',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: false }) }),
    )
  })

  it('PUTs the role under /roles/{roleId}, defaulting activation to elevated', async () => {
    fetchMock.mockResolvedValue(jsonResponse(undefined, true, 204))
    const client = createAdminApiClient({
      baseUrl: 'https://admin-api.example.com',
      getAccessToken: () => 'token-abc',
    })

    await client.assignRole('user-1', 'tenant-admin')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://admin-api.example.com/users/user-1/roles/tenant-admin',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ activation: 'elevated' }),
      }),
    )
  })

  it('sends the chosen activation for assignRole', async () => {
    fetchMock.mockResolvedValue(jsonResponse(undefined, true, 204))
    const client = createAdminApiClient({
      baseUrl: 'https://admin-api.example.com',
      getAccessToken: () => 'token-abc',
    })

    await client.assignRole('user-1', 'tenant-admin', 'default')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://admin-api.example.com/users/user-1/roles/tenant-admin',
      expect.objectContaining({ body: JSON.stringify({ activation: 'default' }) }),
    )
  })

  it('DELETEs the specific role under /roles/{roleId} for revokeRole', async () => {
    fetchMock.mockResolvedValue(jsonResponse(undefined, true, 204))
    const client = createAdminApiClient({
      baseUrl: 'https://admin-api.example.com',
      getAccessToken: () => 'token-abc',
    })

    await client.revokeRole('user-1', 'tenant-admin')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://admin-api.example.com/users/user-1/roles/tenant-admin',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('throws with the response body\'s error message on a non-ok response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, false, 403))
    const client = createAdminApiClient({
      baseUrl: 'https://admin-api.example.com',
      getAccessToken: () => 'token-abc',
    })

    await expect(client.listUsers()).rejects.toThrow('nope')
  })
})
