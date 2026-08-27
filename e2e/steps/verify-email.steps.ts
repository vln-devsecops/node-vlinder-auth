import { When, Then } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { AuthWorld } from '../support/world'

When('I submit an incorrect verification code', async function (this: AuthWorld) {
  await this.page.getByLabel('Verification code').fill('000000')
  await this.page.getByRole('button', { name: 'Verify' }).click()
})

Then('I see a verification error', async function (this: AuthWorld) {
  await expect(this.page.getByRole('alert')).toBeVisible()
})

When('I click resend', async function (this: AuthWorld) {
  await this.page.getByRole('button', { name: 'Resend email' }).click()
})

Then('I see the resend confirmation status', async function (this: AuthWorld) {
  await expect(this.page.getByText('Verification email resent.')).toBeVisible()
})
