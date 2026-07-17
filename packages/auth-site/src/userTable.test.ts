import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminUser, RoleDefinition } from './apiClient'
import { filterUsers, renderUserTable } from './userTable'

const users: AdminUser[] = [
  {
    userId: 'user-1',
    tenantId: 'acme-corp',
    roles: [{ roleId: 'member', activation: 'default' }],
    email: 'jane@acme.com',
    enabled: true,
  },
  {
    userId: 'user-2',
    tenantId: 'globex',
    roles: [
      { roleId: 'member', activation: 'default' },
      { roleId: 'tenant-admin', activation: 'elevated' },
    ],
    email: 'bob@globex.com',
    enabled: false,
  },
]

const roles: RoleDefinition[] = [
  { roleId: 'member', privileges: [], tenantScope: 'tenant' },
  { roleId: 'tenant-admin', privileges: ['admin:users:read:own'], tenantScope: 'tenant' },
  { roleId: 'billing', privileges: ['billing:write:own'], tenantScope: 'tenant' },
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
  let onAddRole: ReturnType<typeof vi.fn>
  let onRemoveRole: ReturnType<typeof vi.fn>

  const render = (multiTenant = false): void => {
    renderUserTable(container, users, roles, {
      multiTenant,
      onToggleEnabled,
      onAddRole,
      onRemoveRole,
    })
  }

  beforeEach(() => {
    container = document.createElement('div')
    onToggleEnabled = vi.fn()
    onAddRole = vi.fn()
    onRemoveRole = vi.fn()
  })

  it('renders one row per user with their email', () => {
    render()

    const rows = container.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('jane@acme.com')
    expect(rows[1].textContent).toContain('bob@globex.com')
  })

  it('shows a tenant column only in multi-tenant mode', () => {
    render(true)
    expect(container.querySelector('[data-column="tenant"]')).not.toBeNull()

    render(false)
    expect(container.querySelector('[data-column="tenant"]')).toBeNull()
  })

  it('labels the toggle button by current enabled state and flips it on click', () => {
    render()

    const buttons = container.querySelectorAll<HTMLButtonElement>('[data-action="toggle-enabled"]')
    expect(buttons[0].textContent).toBe('Disable')
    expect(buttons[1].textContent).toBe('Enable')

    buttons[0].click()
    expect(onToggleEnabled).toHaveBeenCalledWith('user-1', false)

    buttons[1].click()
    expect(onToggleEnabled).toHaveBeenCalledWith('user-2', true)
  })

  it('lists every role a user holds', () => {
    render()

    const secondRowRoles = container
      .querySelectorAll('tbody tr')[1]
      .querySelectorAll('[data-role-item]')
    expect([...secondRowRoles].map((li) => li.getAttribute('data-role-item'))).toEqual([
      'member',
      'tenant-admin',
    ])
  })

  it('reflects each role\'s activation and re-assigns on change', () => {
    render()

    const adminRole = container.querySelector('[data-role-item="tenant-admin"]')!
    const activationSelect = adminRole.querySelector<HTMLSelectElement>('[data-activation-select]')!
    expect(activationSelect.value).toBe('elevated')

    activationSelect.value = 'default'
    activationSelect.dispatchEvent(new Event('change'))
    expect(onAddRole).toHaveBeenCalledWith('user-2', 'tenant-admin', 'default')
  })

  it('removes a specific role on the × button', () => {
    render()

    const adminRole = container.querySelector('[data-role-item="tenant-admin"]')!
    adminRole.querySelector<HTMLButtonElement>('[data-action="remove-role"]')!.click()
    expect(onRemoveRole).toHaveBeenCalledWith('user-2', 'tenant-admin')
  })

  it('offers only not-yet-held roles in the add control, defaulting to sudo', () => {
    render()

    // user-1 holds "member"; billing and tenant-admin remain addable.
    const firstRow = container.querySelectorAll('tbody tr')[0]
    const addSelect = firstRow.querySelector<HTMLSelectElement>('[data-add-role-select]')!
    expect([...addSelect.options].map((o) => o.value).sort()).toEqual(['billing', 'tenant-admin'])

    const addActivation = firstRow.querySelector<HTMLSelectElement>('[data-add-activation-select]')!
    expect(addActivation.value).toBe('elevated')

    addSelect.value = 'billing'
    firstRow.querySelector<HTMLButtonElement>('[data-action="add-role"]')!.click()
    expect(onAddRole).toHaveBeenCalledWith('user-1', 'billing', 'elevated')
  })
})
