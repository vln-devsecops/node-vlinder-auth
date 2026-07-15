import { createAdminApiClient } from './apiClient'
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

  const [users, roles] = await Promise.all([apiClient.listUsers(), apiClient.listRoles()])

  const rerender = (visibleUsers: typeof users): void => {
    renderUserTable(tableContainer, visibleUsers, roles, {
      multiTenant,
      onToggleEnabled: async (userId, enabled) => {
        await apiClient.setUserEnabled(userId, enabled)
        rerender(filterUsers(users, searchInput.value))
      },
      onChangeRole: async (userId, roleId) => {
        await apiClient.assignRole(userId, roleId)
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

