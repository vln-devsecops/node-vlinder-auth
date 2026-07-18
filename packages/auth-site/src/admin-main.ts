import { createAdminApiClient, type AdminUser } from './apiClient'
import { isMultiTenant } from './authConfig'
import { loadSession, isSessionExpired } from './session'
import { loadConfig } from './config'
import { filterUsers, renderUserTable } from './userTable'

async function main(): Promise<void> {
  // The token itself is an HttpOnly cookie the SPA can't read; this marker only
  // tells us whether to bother rendering or bounce to the login page. The
  // cookie is the real credential (sent automatically on the API calls below).
  const session = loadSession()
  if (!session || isSessionExpired(session)) {
    window.location.href = '/'
    return
  }

  const config = await loadConfig()
  const multiTenant = isMultiTenant(config.multiTenant)

  const apiClient = createAdminApiClient({ baseUrl: '/api/v1' })

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

