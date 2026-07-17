import { Given, When, Then } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { AuthWorld } from '../support/world'
import { pollUntil } from '../support/poll'
import { TEST_PASSWORD } from './common.steps'
import { fillSignInForm, waitForAdminRedirect } from '../support/actions'

Given('I am signed in as an admin', async function (this: AuthWorld) {
  this.testUser = await this.createConfirmedTestUser('admin', TEST_PASSWORD)
  await this.seedRoleAssignment(this.testUser.userId, 'admin')

  await this.page.goto('/')
  await fillSignInForm(this, this.testUser.email, this.testUser.password)
  await waitForAdminRedirect(this)
})

// Deliberately seeded with "member" (no admin privileges) -- this is the
// user being acted on, not an actor. Also confirms listUsers surfaces any
// role-assigned user, not just other admins.
Given('a user exists to manage', async function (this: AuthWorld) {
  this.managedUser = await this.createConfirmedTestUser('managed', TEST_PASSWORD)
  await this.seedRoleAssignment(this.managedUser.userId, 'member')
})

function managedUserRow(world: AuthWorld) {
  if (!world.managedUser) {
    throw new Error('No managed user set up for this scenario')
  }
  return world.page.locator('tr', { hasText: world.managedUser.email })
}

Then('I see the managed user in the user table', async function (this: AuthWorld) {
  if (!this.managedUser) {
    throw new Error('No managed user set up for this scenario')
  }
  await expect(this.page.locator('#user-table')).toContainText(this.managedUser.email)
})

When('I disable the managed user from the admin panel', async function (this: AuthWorld) {
  await managedUserRow(this).locator('[data-action="toggle-enabled"]').click()
})

Then('the managed user is disabled in Cognito', async function (this: AuthWorld) {
  if (!this.managedUser) {
    throw new Error('No managed user set up for this scenario')
  }
  const enabled = await pollUntil(
    () => this.getUserEnabledState(this.managedUser!.email),
    (value) => value === false,
  )
  expect(enabled).toBe(false)
})

When('I grant the managed user the {string} role', async function (this: AuthWorld, roleId: string) {
  const row = managedUserRow(this)
  await row.locator('[data-add-role-select]').selectOption(roleId)
  await row.locator('[data-action="add-role"]').click()
})

Then('the managed user holds the {string} role', async function (this: AuthWorld, roleId: string) {
  if (!this.managedUser) {
    throw new Error('No managed user set up for this scenario')
  }
  const assignments = await pollUntil(
    () => this.getRoleAssignments(this.managedUser!.userId),
    (result) => result.some((a) => a.roleId === roleId),
  )
  expect(assignments.map((a) => a.roleId)).toContain(roleId)
})

Then(
  'the managed user still holds the {string} role',
  async function (this: AuthWorld, roleId: string) {
    if (!this.managedUser) {
      throw new Error('No managed user set up for this scenario')
    }
    const assignments = await this.getRoleAssignments(this.managedUser.userId)
    expect(
      assignments.map((a) => a.roleId),
      'granting a new role must not remove existing ones',
    ).toContain(roleId)
  },
)

When('I remove the {string} role from the managed user', async function (this: AuthWorld, roleId: string) {
  await managedUserRow(this).locator(`[data-role-item="${roleId}"] [data-action="remove-role"]`).click()
})

Then(
  'the managed user no longer holds the {string} role',
  async function (this: AuthWorld, roleId: string) {
    if (!this.managedUser) {
      throw new Error('No managed user set up for this scenario')
    }
    const assignments = await pollUntil(
      () => this.getRoleAssignments(this.managedUser!.userId),
      (result) => !result.some((a) => a.roleId === roleId),
    )
    expect(assignments.map((a) => a.roleId)).not.toContain(roleId)
  },
)
