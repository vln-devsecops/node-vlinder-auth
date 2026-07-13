import { Before, After, setDefaultTimeout } from '@cucumber/cucumber'
import type { AuthWorld } from './world'

// cucumber.json's "timeout" key is not a real cucumber-js option and was
// silently ignored -- confirmed via `cucumber-js --help`, no such flag
// exists. setDefaultTimeout() is the actual documented API for this,
// and must be called before Before/Given/When/Then are registered.
// Cucumber's own hard-coded default is 5000ms, too short for a real
// browser launch + navigation + Cognito API round trip.
setDefaultTimeout(60 * 1000)

Before(async function (this: AuthWorld) {
  this.assertEnv()
  await this.launchBrowser()
})

After(async function (this: AuthWorld) {
  await this.cleanupUsers()
  await this.closeBrowser()
})
