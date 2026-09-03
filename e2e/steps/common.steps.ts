import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { AuthWorld } from '../support/world'

export const TEST_PASSWORD = 'TestPassw0rd!'

// Seeded with the admin role (not just "confirmed") because every scenario
// using this step signs in and expects to actually reach a working /admin
// page -- listUsers enumerates the role-assignments table, not Cognito
// directly, so a user with no assignment gets a 403 from the admin API and
// never renders a table at all. See admin-panel.feature's "a user exists to
// manage" step for a deliberately unprivileged user.
Given('a confirmed test user exists', async function (this: AuthWorld) {
  this.testUser = await this.createConfirmedTestUser('signin', TEST_PASSWORD)
  await this.seedRoleAssignment(this.testUser.userId, 'admin')
})

When('I visit the auth site', async function (this: AuthWorld) {
  await this.page.goto('/')
})

// Deliberately checks only that the panel carries the expected company name
// and some non-empty tagline, not the exact tagline copy -- this step is
// meant to keep working once a real deployment injects a custom AuthProfile
// via config.json (see doc/plan-auth-chrome-and-verification-codes.md, Step
// 9), not just today's built-in "default" profile.
Then('the {string} brand panel is visible', async function (this: AuthWorld, companyName: string) {
  const panel = this.page.locator('.auth-chrome-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText(companyName)
  await expect(panel.locator('p')).not.toBeEmpty()
})
