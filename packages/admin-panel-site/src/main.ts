import { UserManager } from 'oidc-client-ts'
import { createAdminApiClient } from './apiClient'
import { buildOidcConfig, isMultiTenant, type AdminPanelEnv } from './oidcConfig'
import { filterUsers, renderUserTable } from './userTable'

const env = import.meta.env as unknown as AdminPanelEnv
const userManager = new UserManager(buildOidcConfig(env))
const multiTenant = isMultiTenant(env)

async function main(): Promise<void> {
  if (window.location.search.includes('code=')) {
    await userManager.signinRedirectCallback()
    window.history.replaceState({}, document.title, window.location.pathname)
  }

  const user = await userManager.getUser()
  if (!user || user.expired) {
    await userManager.signinRedirect()
    return
  }

  const apiClient = createAdminApiClient({
    baseUrl: env.VITE_ADMIN_API_BASE_URL,
    getAccessToken: () => user.access_token,
  })

  const [users, roles] = await Promise.all([apiClient.listUsers(), apiClient.listRoles()])
  const tableContainer = document.getElementById('user-table')!
  const searchInput = document.getElementById('search') as HTMLInputElement

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
