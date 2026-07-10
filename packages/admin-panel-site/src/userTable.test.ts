import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminUser, RoleDefinition } from './apiClient'
import { filterUsers, renderUserTable } from './userTable'

const users: AdminUser[] = [
  { userId: 'user-1', tenantId: 'acme-corp', roleId: 'member', email: 'jane@acme.com', enabled: true },
  {
    userId: 'user-2',
    tenantId: 'globex',
    roleId: 'tenant-admin',
    email: 'bob@globex.com',
    enabled: false,
  },
]

const roles: RoleDefinition[] = [
  { roleId: 'member', privileges: [], tenantScope: 'tenant' },
  { roleId: 'tenant-admin', privileges: ['admin:users:read:own'], tenantScope: 'tenant' },
]

describe('filterUsers', () => {
  it('filters case-insensitively by email substring', () => {
    expect(filterUsers(users, 'JANE')).toEqual([users[0]])
    expect(filterUsers(users, 'globex.com')).toEqual([users[1]])
    expect(filterUsers(users, '')).toEqual(users)
  })
})

describe('renderUserTable', () => {
  let container: HTMLElement
  let onToggleEnabled: ReturnType<typeof vi.fn>
  let onChangeRole: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    onToggleEnabled = vi.fn()
    onChangeRole = vi.fn()
  })

  it('renders one row per user with their email', () => {
    renderUserTable(container, users, roles, {
      multiTenant: false,
      onToggleEnabled,
      onChangeRole,
    })

    const rows = container.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('jane@acme.com')
    expect(rows[1].textContent).toContain('bob@globex.com')
  })

  it('shows a tenant column only in multi-tenant mode', () => {
    renderUserTable(container, users, roles, {
      multiTenant: true,
      onToggleEnabled,
      onChangeRole,
    })
    expect(container.querySelector('[data-column="tenant"]')).not.toBeNull()

    renderUserTable(container, users, roles, {
      multiTenant: false,
      onToggleEnabled,
      onChangeRole,
    })
    expect(container.querySelector('[data-column="tenant"]')).toBeNull()
  })

  it('labels the toggle button by current enabled state and flips it on click', () => {
    renderUserTable(container, users, roles, {
      multiTenant: false,
      onToggleEnabled,
      onChangeRole,
    })

    const buttons = container.querySelectorAll<HTMLButtonElement>('[data-action="toggle-enabled"]')
    expect(buttons[0].textContent).toBe('Disable')
    expect(buttons[1].textContent).toBe('Enable')

    buttons[0].click()
    expect(onToggleEnabled).toHaveBeenCalledWith('user-1', false)

    buttons[1].click()
    expect(onToggleEnabled).toHaveBeenCalledWith('user-2', true)
  })

  it('renders a role select per user and calls onChangeRole when changed', () => {
    renderUserTable(container, users, roles, {
      multiTenant: false,
      onToggleEnabled,
      onChangeRole,
    })

    const selects = container.querySelectorAll<HTMLSelectElement>('[data-role-select]')
    expect(selects[0].value).toBe('member')

    selects[0].value = 'tenant-admin'
    selects[0].dispatchEvent(new Event('change'))

    expect(onChangeRole).toHaveBeenCalledWith('user-1', 'tenant-admin')
  })
})
