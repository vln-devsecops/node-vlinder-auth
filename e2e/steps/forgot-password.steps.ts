import { When, Then } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { AuthWorld } from '../support/world'
import { pollUntil } from '../support/poll'

const RESET_PURPOSE = 'password-reset'
const NEW_PASSWORD = 'NewTestPassw0rd!'

When('I request a password reset code', async function (this: AuthWorld) {
  if (!this.testUser) {
    throw new Error('No test user set up for this scenario')
  }
  await this.page.getByRole('button', { name: 'Forgot password?' }).click()
  await this.page.getByLabel('Email').fill(this.testUser.email)
  await this.page.getByRole('button', { name: 'Send reset code' }).click()
})

When('I submit the reset code with a new password', async function (this: AuthWorld) {
  if (!this.testUser) {
    throw new Error('No test user set up for this scenario')
  }
  const email = this.testUser.email

  const code = await pollUntil(
    () => this.getVerificationCode(email, RESET_PURPOSE),
    (result) => result !== undefined,
  )
  if (!code) {
    throw new Error(`No password-reset verification code was ever written for ${email}`)
  }

  await this.page.getByLabel('Confirmation code').fill(code)
  await this.page.getByLabel('New password').fill(NEW_PASSWORD)
  await this.page.getByRole('button', { name: 'Reset password' }).click()

  // fillSignInForm (via "I sign in with valid credentials") reads this back.
  this.testUser.password = NEW_PASSWORD
})

When('I submit an incorrect reset code', async function (this: AuthWorld) {
  await this.page.getByLabel('Confirmation code').fill('000000')
  await this.page.getByLabel('New password').fill(NEW_PASSWORD)
  await this.page.getByRole('button', { name: 'Reset password' }).click()
})

Then('I see a password-reset error', async function (this: AuthWorld) {
  await expect(this.page.getByRole('alert')).toBeVisible()
})
