import { Given, When } from '@cucumber/cucumber'
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
