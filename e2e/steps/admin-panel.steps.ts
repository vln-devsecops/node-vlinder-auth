import { Given, When, Then } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { AuthWorld } from '../support/world'
import { pollUntil } from '../support/poll'
import { TEST_PASSWORD } from './common.steps'

Given('I am signed in as an admin', async function (this: AuthWorld) {
  this.testUser = await this.createConfirmedTestUser('admin', TEST_PASSWORD)
  await this.seedRoleAssignment(this.testUser.userId, 'admin')

  await this.page.goto('/')
  await this.page.getByLabel('Email').fill(this.testUser.email)
  await this.page.getByLabel('Password').fill(this.testUser.password)
  await this.page.getByRole('button', { name: 'Sign in' }).click()
  await this.page.waitForURL('**/admin', { timeout: 15000 })
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

When('I change the managed user\'s role to {string}', async function (this: AuthWorld, roleId: string) {
  await managedUserRow(this).locator('select[data-role-select]').selectOption(roleId)
})

Then('the managed user\'s role assignment is {string}', async function (this: AuthWorld, roleId: string) {
  if (!this.managedUser) {
    throw new Error('No managed user set up for this scenario')
  }
  const assignment = await pollUntil(
    () => this.getRoleAssignment(this.managedUser!.userId),
    (result) => result?.roleId === roleId,
  )
  expect(assignment?.roleId).toBe(roleId)
})
