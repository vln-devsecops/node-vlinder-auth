import { When, Then } from '@cucumber/cucumber'
import type { AuthWorld } from '../support/world'

When('I visit the admin panel directly', async function (this: AuthWorld) {
  await this.page.goto('/admin')
})

Then('I am redirected to the sign-in page', async function (this: AuthWorld) {
  await this.page.waitForURL(/\/$|\/index\.html$/, { timeout: 10000 })
})
