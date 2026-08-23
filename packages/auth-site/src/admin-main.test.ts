import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loadSessionMock = vi.fn()
const isSessionExpiredMock = vi.fn()
const loadConfigMock = vi.fn()
const createAdminApiClientMock = vi.fn()

vi.mock('./session', () => ({
  loadSession: loadSessionMock,
  isSessionExpired: isSessionExpiredMock,
}))
vi.mock('./config', () => ({
  loadConfig: loadConfigMock,
}))
vi.mock('./apiClient', () => ({
  createAdminApiClient: createAdminApiClientMock,
}))
vi.mock('./authConfig', () => ({
  isMultiTenant: (value: boolean) => value,
}))
vi.mock('./userTable', () => ({
  filterUsers: vi.fn(() => []),
  renderUserTable: vi.fn(),
}))

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('admin-main', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<main id="app"><input id="search" /><div id="user-table"></div></main>'
    loadSessionMock.mockReturnValue({ expiresAt: Date.now() + 100_000 })
    isSessionExpiredMock.mockReturnValue(false)
  })

  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('renders a disabled notice and never calls the admin API when adminEnabled is false', async () => {
    loadConfigMock.mockResolvedValue({
      userPoolClientId: 'client-1',
      multiTenant: false,
      adminEnabled: false,
    })

    await import('./admin-main')
    await flushMicrotasks()

    expect(createAdminApiClientMock).not.toHaveBeenCalled()
    expect(document.getElementById('app')?.textContent).toContain('not enabled')
  })

  it('proceeds to call the admin API when adminEnabled is true', async () => {
    loadConfigMock.mockResolvedValue({
      userPoolClientId: 'client-1',
      multiTenant: false,
      adminEnabled: true,
    })
    createAdminApiClientMock.mockReturnValue({
      listRoles: vi.fn().mockResolvedValue([]),
      listUsers: vi.fn().mockResolvedValue([]),
    })

    await import('./admin-main')
    await flushMicrotasks()

    expect(createAdminApiClientMock).toHaveBeenCalledWith({ baseUrl: '/api/v1' })
  })
})
