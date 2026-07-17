import type { AdminUser, RoleActivation, RoleDefinition } from './apiClient'

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
  /** Add a role, or change a held role's activation (the API upserts on roleId). */
  onAddRole: (userId: string, roleId: string, activation: RoleActivation) => void
  onRemoveRole: (userId: string, roleId: string) => void
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

  const headers = ['Email', ...(options.multiTenant ? ['Tenant'] : []), 'Roles', 'Status', '']
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

const ACTIVATIONS: RoleActivation[] = ['default', 'elevated']
const ACTIVATION_LABEL: Record<RoleActivation, string> = {
  default: 'login',
  elevated: 'sudo',
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

  row.appendChild(renderRolesCell(user, roles, options))

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

function renderRolesCell(
  user: AdminUser,
  roles: RoleDefinition[],
  options: RenderUserTableOptions,
): HTMLTableCellElement {
  const cell = document.createElement('td')
  cell.dataset.column = 'roles'

  const list = document.createElement('ul')
  list.dataset.roleList = ''
  for (const assigned of user.roles) {
    const item = document.createElement('li')
    item.dataset.roleItem = assigned.roleId

    const label = document.createElement('span')
    label.dataset.roleId = ''
    label.textContent = assigned.roleId
    item.appendChild(label)

    // Activation select: switching login <-> sudo re-PUTs the same roleId.
    const activationSelect = document.createElement('select')
    activationSelect.dataset.activationSelect = ''
    for (const activation of ACTIVATIONS) {
      const option = document.createElement('option')
      option.value = activation
      option.textContent = ACTIVATION_LABEL[activation]
      activationSelect.appendChild(option)
    }
    activationSelect.value = assigned.activation
    activationSelect.addEventListener('change', () => {
      options.onAddRole(user.userId, assigned.roleId, activationSelect.value as RoleActivation)
    })
    item.appendChild(activationSelect)

    const removeButton = document.createElement('button')
    removeButton.dataset.action = 'remove-role'
    removeButton.textContent = '×'
    removeButton.setAttribute('aria-label', `Remove ${assigned.roleId}`)
    removeButton.addEventListener('click', () => {
      options.onRemoveRole(user.userId, assigned.roleId)
    })
    item.appendChild(removeButton)

    list.appendChild(item)
  }
  cell.appendChild(list)

  cell.appendChild(renderAddRoleControl(user, roles, options))
  return cell
}

function renderAddRoleControl(
  user: AdminUser,
  roles: RoleDefinition[],
  options: RenderUserTableOptions,
): HTMLElement {
  const held = new Set(user.roles.map((role) => role.roleId))
  const available = roles.filter((role) => !held.has(role.roleId))

  const wrapper = document.createElement('div')
  wrapper.dataset.addRole = ''

  const roleSelect = document.createElement('select')
  roleSelect.dataset.addRoleSelect = ''
  for (const role of available) {
    const option = document.createElement('option')
    option.value = role.roleId
    option.textContent = role.roleId
    roleSelect.appendChild(option)
  }

  const activationSelect = document.createElement('select')
  activationSelect.dataset.addActivationSelect = ''
  for (const activation of ACTIVATIONS) {
    const option = document.createElement('option')
    option.value = activation
    option.textContent = ACTIVATION_LABEL[activation]
    activationSelect.appendChild(option)
  }
  // New grants default to sudo (elevated), matching the backend default.
  activationSelect.value = 'elevated'

  const addButton = document.createElement('button')
  addButton.dataset.action = 'add-role'
  addButton.textContent = 'Add role'
  // Nothing left to add -> disable the control rather than offer an empty select.
  addButton.disabled = available.length === 0
  roleSelect.disabled = available.length === 0
  activationSelect.disabled = available.length === 0
  addButton.addEventListener('click', () => {
    if (!roleSelect.value) {
      return
    }
    options.onAddRole(user.userId, roleSelect.value, activationSelect.value as RoleActivation)
  })

  wrapper.append(roleSelect, activationSelect, addButton)
  return wrapper
}
