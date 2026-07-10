export interface AdminUser {
  userId: string
  tenantId: string
  roleId: string
  email?: string
  enabled?: boolean
  userStatus?: string
}

export interface RoleDefinition {
  roleId: string
  privileges: string[]
  tenantScope: 'tenant' | 'global'
}

export interface AdminApiClientConfig {
  baseUrl: string
  getAccessToken: () => string | undefined
}

export interface AdminApiClient {
  listUsers: () => Promise<AdminUser[]>
  getUser: (userId: string) => Promise<AdminUser>
  setUserEnabled: (userId: string, enabled: boolean) => Promise<void>
  listRoles: () => Promise<RoleDefinition[]>
  assignRole: (userId: string, roleId: string) => Promise<void>
  revokeRole: (userId: string) => Promise<void>
}

/** Thin fetch wrapper over cognito_auth's bundled admin API. No framework, no build step beyond Vite. */
export function createAdminApiClient(config: AdminApiClientConfig): AdminApiClient {
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${config.getAccessToken() ?? ''}`,
      },
    })

    const body = response.status === 204 ? undefined : await response.json()

    if (!response.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body
          ? String((body as { error: unknown }).error)
          : `Request to ${path} failed with status ${response.status}`
      throw new Error(message)
    }

    return body as T
  }

  return {
    listUsers: async () => (await request<{ users: AdminUser[] }>('/users')).users,
    getUser: (userId) => request<AdminUser>(`/users/${userId}`),
    setUserEnabled: (userId, enabled) =>
      request(`/users/${userId}/enabled`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
    listRoles: async () => (await request<{ roles: RoleDefinition[] }>('/roles')).roles,
    assignRole: (userId, roleId) =>
      request(`/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ roleId }),
      }),
    revokeRole: (userId) => request(`/users/${userId}/role`, { method: 'DELETE' }),
  }
}
