export type RoleActivation = 'default' | 'elevated'

/** A role a user holds: active at login (`default`) or held for sudo (`elevated`). */
export interface AssignedRole {
  roleId: string
  activation: RoleActivation
}

export interface AdminUser {
  userId: string
  tenantId: string
  roles: AssignedRole[]
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
}

export interface AdminApiClient {
  listUsers: () => Promise<AdminUser[]>
  getUser: (userId: string) => Promise<AdminUser>
  setUserEnabled: (userId: string, enabled: boolean) => Promise<void>
  listRoles: () => Promise<RoleDefinition[]>
  /** Adds/updates a role for a user. Omit activation to hold it for sudo (elevated). */
  assignRole: (userId: string, roleId: string, activation?: RoleActivation) => Promise<void>
  revokeRole: (userId: string, roleId: string) => Promise<void>
}

/** Thin fetch wrapper over vlinder_auth's bundled admin API. No framework, no build step beyond Vite. */
export function createAdminApiClient(config: AdminApiClientConfig): AdminApiClient {
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    // Auth rides the HttpOnly session cookie (same-origin) -- the admin API's
    // edge function turns it into the Authorization header. The SPA holds no
    // token and sends no Authorization header itself.
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      credentials: 'same-origin',
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
    assignRole: (userId, roleId, activation = 'elevated') =>
      request(`/users/${userId}/roles/${roleId}`, {
        method: 'PUT',
        body: JSON.stringify({ activation }),
      }),
    revokeRole: (userId, roleId) =>
      request(`/users/${userId}/roles/${roleId}`, { method: 'DELETE' }),
  }
}
