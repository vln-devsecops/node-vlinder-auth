import { When, Then } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { AuthWorld } from '../support/world'
import { pollUntil } from '../support/poll'
import { TEST_PASSWORD } from './common.steps'

When('I sign up with a new email and password', async function (this: AuthWorld) {
  const email = `signup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  this.testUser = { email, password: TEST_PASSWORD, userId: '' }

  await this.page.getByRole('button', { name: 'Create account' }).click()
  await this.page.getByLabel('Email').fill(email)
  await this.page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
  await this.page.getByLabel('Confirm password').fill(TEST_PASSWORD)
  await this.page.getByRole('button', { name: 'Sign up' }).click()
})

Then('I see the verify-email notice', async function (this: AuthWorld) {
  await expect(this.page.getByText(/verification link/i)).toBeVisible()
})

When('the account is confirmed', async function (this: AuthWorld) {
  if (!this.testUser) {
    throw new Error('No test user set up for this scenario')
  }
  await this.confirmSignUp(this.testUser.email)
  this.testUser.userId = await this.getUserId(this.testUser.email)
})

Then('the account has the default role assigned', async function (this: AuthWorld) {
  if (!this.testUser) {
    throw new Error('No test user set up for this scenario')
  }
  const assignment = await pollUntil(
    () => this.getRoleAssignment(this.testUser!.userId),
    (result) => result !== null,
  )
  expect(assignment, 'post-confirmation trigger did not write a role assignment').not.toBeNull()
  // "member" is the module's default_role_id default -- if this ever legitimately
  // changes, update here alongside whatever changed the module default, don't
  // just loosen the assertion.
  expect(assignment?.roleId).toBe('member')
})
