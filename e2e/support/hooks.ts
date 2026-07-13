import { Before, After } from '@cucumber/cucumber'
import type { AuthWorld } from './world'

Before(async function (this: AuthWorld) {
  this.assertEnv()
  await this.launchBrowser()
})

After(async function (this: AuthWorld) {
  await this.cleanupUsers()
  await this.closeBrowser()
})
