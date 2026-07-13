import { When, Then } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { AuthWorld } from '../support/world'

async function fillSignInForm(world: AuthWorld, email: string, password: string): Promise<void> {
  await world.page.getByLabel('Email').fill(email)
  await world.page.getByLabel('Password').fill(password)
  await world.page.getByRole('button', { name: 'Sign in' }).click()
}

When('I sign in with valid credentials', async function (this: AuthWorld) {
  if (!this.testUser) {
    throw new Error('No test user set up for this scenario')
  }
  await fillSignInForm(this, this.testUser.email, this.testUser.password)
})

When('I sign in with an incorrect password', async function (this: AuthWorld) {
  if (!this.testUser) {
    throw new Error('No test user set up for this scenario')
  }
  await fillSignInForm(this, this.testUser.email, 'DefinitelyWrongPassw0rd!')
})

Then('I am redirected to the admin panel', async function (this: AuthWorld) {
  await this.page.waitForURL('**/admin', { timeout: 15000 })
})

Then('the user table is visible', async function (this: AuthWorld) {
  await expect(this.page.locator('#user-table table')).toBeVisible()
})

Then('I see a sign-in error', async function (this: AuthWorld) {
  await expect(this.page.getByRole('alert')).toBeVisible()
})

Then('I remain on the sign-in page', async function (this: AuthWorld) {
  await expect(this.page).toHaveURL(/\/$|\/index\.html$/)
})
