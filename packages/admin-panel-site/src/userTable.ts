import type { AdminUser, RoleDefinition } from './apiClient'

/** Case-insensitive email substring filter, driving the search box. */
export function filterUsers(users: AdminUser[], query: string): AdminUser[] {
  if (!query) {
    return users
  }
  const needle = query.toLowerCase()
  return users.filter((user) => (user.email ?? '').toLowerCase().includes(needle))
}

export interface RenderUserTableOptions {
  multiTenant: boolean
  onToggleEnabled: (userId: string, enabled: boolean) => void
  onChangeRole: (userId: string, roleId: string) => void
}

/**
 * Renders the user table directly with DOM APIs -- no framework, matching
 * the "fairly light" bundled admin panel this package builds for
 * cognito_auth. Replaces container's contents each call.
 */
export function renderUserTable(
  container: HTMLElement,
  users: AdminUser[],
  roles: RoleDefinition[],
  options: RenderUserTableOptions,
): void {
  const table = document.createElement('table')
  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')

  const headers = ['Email', ...(options.multiTenant ? ['Tenant'] : []), 'Role', 'Status', '']
  for (const label of headers) {
    const th = document.createElement('th')
    th.textContent = label
    if (label === 'Tenant') {
      th.dataset.column = 'tenant'
    }
    headerRow.appendChild(th)
  }
  thead.appendChild(headerRow)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  for (const user of users) {
    tbody.appendChild(renderUserRow(user, roles, options))
  }
  table.appendChild(tbody)

  container.replaceChildren(table)
}

function renderUserRow(
  user: AdminUser,
  roles: RoleDefinition[],
  options: RenderUserTableOptions,
): HTMLTableRowElement {
  const row = document.createElement('tr')

  const emailCell = document.createElement('td')
  emailCell.textContent = user.email ?? user.userId
  row.appendChild(emailCell)

  if (options.multiTenant) {
    const tenantCell = document.createElement('td')
    tenantCell.dataset.column = 'tenant'
    tenantCell.textContent = user.tenantId
    row.appendChild(tenantCell)
  }

  const roleCell = document.createElement('td')
  const roleSelect = document.createElement('select')
  roleSelect.dataset.roleSelect = ''
  for (const role of roles) {
    const option = document.createElement('option')
    option.value = role.roleId
    option.textContent = role.roleId
    roleSelect.appendChild(option)
  }
  roleSelect.value = user.roleId
  roleSelect.addEventListener('change', () => {
    options.onChangeRole(user.userId, roleSelect.value)
  })
  roleCell.appendChild(roleSelect)
  row.appendChild(roleCell)

  const statusCell = document.createElement('td')
  statusCell.textContent = user.enabled ? 'Enabled' : 'Disabled'
  row.appendChild(statusCell)

  const actionCell = document.createElement('td')
  const toggleButton = document.createElement('button')
  toggleButton.dataset.action = 'toggle-enabled'
  toggleButton.textContent = user.enabled ? 'Disable' : 'Enable'
  toggleButton.addEventListener('click', () => {
    options.onToggleEnabled(user.userId, !user.enabled)
  })
  actionCell.appendChild(toggleButton)
  row.appendChild(actionCell)

  return row
}
