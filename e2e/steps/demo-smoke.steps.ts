import { Given, When, Then } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { AuthWorld } from '../support/world'
import { fillSignInForm, waitForAdminRedirect } from '../support/actions'

function demoCredentials(): { email: string; password: string } {
  const email = process.env['DEMO_USER_EMAIL']
  const password = process.env['DEMO_USER_PASSWORD']
  if (!email || !password) {
    throw new Error(
      'DEMO_USER_EMAIL and DEMO_USER_PASSWORD must be set (from the demo stack outputs) to run the demo smoke test',
    )
  }
  return { email, password }
}

Given('the seeded demo user\'s credentials are configured', function (this: AuthWorld) {
  demoCredentials()
})

When('the demo user signs in at the demo site', async function (this: AuthWorld) {
  const { email, password } = demoCredentials()
  await this.page.goto('/')
  await fillSignInForm(this, email, password)
})

Then('they reach the admin panel', async function (this: AuthWorld) {
  await waitForAdminRedirect(this)
  await expect(this.page.locator('#user-table')).toBeVisible({ timeout: 15000 })
})
