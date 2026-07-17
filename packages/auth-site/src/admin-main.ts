import { createAdminApiClient, type AdminUser } from './apiClient'
import { isMultiTenant } from './authConfig'
import { loadTokens, isTokenExpired } from './session'
import { loadConfig } from './config'
import { filterUsers, renderUserTable } from './userTable'

async function main(): Promise<void> {
  const tokens = loadTokens()
  if (!tokens || isTokenExpired(tokens)) {
    window.location.href = '/'
    return
  }

  const config = await loadConfig()
  const multiTenant = isMultiTenant(config.multiTenant)

  const apiClient = createAdminApiClient({
    baseUrl: '/api/v1',
    getAccessToken: () => tokens.accessToken,
  })

  const tableContainer = document.getElementById('user-table')!
  const searchInput = document.getElementById('search') as HTMLInputElement

  const roles = await apiClient.listRoles()
  let users = await apiClient.listUsers()

  // Role add/remove changes what a row shows, so re-fetch and re-render after
  // each mutation (the panel is small; a full refresh keeps state simple).
  const refresh = async (): Promise<void> => {
    users = await apiClient.listUsers()
    rerender(filterUsers(users, searchInput.value))
  }

  const rerender = (visibleUsers: AdminUser[]): void => {
    renderUserTable(tableContainer, visibleUsers, roles, {
      multiTenant,
      onToggleEnabled: async (userId, enabled) => {
        await apiClient.setUserEnabled(userId, enabled)
        await refresh()
      },
      onAddRole: async (userId, roleId, activation) => {
        await apiClient.assignRole(userId, roleId, activation)
        await refresh()
      },
      onRemoveRole: async (userId, roleId) => {
        await apiClient.revokeRole(userId, roleId)
        await refresh()
      },
    })
  }

  searchInput.addEventListener('input', () => {
    rerender(filterUsers(users, searchInput.value))
  })

  rerender(users)
}

main().catch((error: unknown) => {
  console.error('Admin panel failed to load', error)
})

