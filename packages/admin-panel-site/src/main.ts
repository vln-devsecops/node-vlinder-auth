import { createAdminApiClient } from './apiClient'
import { buildInitiateAuthBody, isMultiTenant, parseAuthResult, type AuthSiteEnv } from './authConfig'
import { filterUsers, renderUserTable } from './userTable'

const env = import.meta.env as unknown as AuthSiteEnv
const multiTenant = isMultiTenant(env)

/** Sign in via CloudFront's /idp path (proxied to cognito-idp.<region>.amazonaws.com). */
async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch('/idp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify(buildInitiateAuthBody(env.VITE_USER_POOL_CLIENT_ID, email, password)),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { __type?: string; message?: string }
    throw new Error(body.message ?? `Auth failed: ${response.status}`)
  }
  const tokens = parseAuthResult((await response.json()) as Record<string, Record<string, unknown>>)
  return tokens.accessToken
}

async function main(): Promise<void> {
  const loginForm = document.getElementById('login-form') as HTMLFormElement | null
  const tableContainer = document.getElementById('user-table')!
  const searchInput = document.getElementById('search') as HTMLInputElement

  let accessToken: string | null = null

  async function loadAdminPanel(token: string): Promise<void> {
    if (loginForm) {
      loginForm.style.display = 'none'
    }
    const apiClient = createAdminApiClient({
      baseUrl: env.VITE_ADMIN_API_BASE_URL,
      getAccessToken: () => token,
    })
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

  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      const emailInput = loginForm.querySelector<HTMLInputElement>('[type=email]')
      const passwordInput = loginForm.querySelector<HTMLInputElement>('[type=password]')
      const errorEl = document.getElementById('login-error')

      try {
        accessToken = await signIn(emailInput!.value, passwordInput!.value)
        await loadAdminPanel(accessToken)
      } catch (err: unknown) {
        if (errorEl) {
          errorEl.textContent = err instanceof Error ? err.message : 'Sign-in failed.'
        }
      }
    })
  }
}

main().catch((error: unknown) => {
  console.error('Admin panel failed to load', error)
})

