import { Before, BeforeAll, After, setDefaultTimeout } from '@cucumber/cucumber'
import type { AuthWorld } from './world'

// cucumber.json's "timeout" key is not a real cucumber-js option and was
// silently ignored -- confirmed via `cucumber-js --help`, no such flag
// exists. setDefaultTimeout() is the actual documented API for this,
// and must be called before Before/Given/When/Then are registered.
// Cucumber's own hard-coded default is 5000ms, too short for a real
// browser launch + navigation + Cognito API round trip.
setDefaultTimeout(60 * 1000)

// Real run diagnosis: scenarios that happen to run first (right after a fresh
// `terraform apply` deployed the SPA) consistently time out on the sign-in
// redirect; scenarios running later in the same suite pass with the exact
// same code path. That's a CloudFront-propagation-after-deploy symptom, not a
// code bug -- the module's `aws s3 sync` + invalidation completing doesn't mean
// the distribution is actually serving the new content at every edge location
// yet. Poll the site once, before any scenario, so the whole suite doesn't
// pay for this in flaky per-scenario timeouts.
BeforeAll({ timeout: 120 * 1000 }, async () => {
  const baseUrl = process.env['E2E_BASE_URL']
  if (!baseUrl) {
    // Let the first scenario's own assertEnv() produce the real error
    // message instead of duplicating that validation here.
    return
  }

  const deadline = Date.now() + 90 * 1000
  let lastStatus: number | string = 'no response yet'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { redirect: 'follow' })
      lastStatus = response.status
      if (response.ok) {
        return
      }
    } catch (err) {
      lastStatus = err instanceof Error ? err.message : String(err)
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  throw new Error(`Auth site at ${baseUrl} never became ready (last status: ${lastStatus})`)
})

Before(async function (this: AuthWorld) {
  this.assertEnv()
  await this.launchBrowser()
})

After(async function (this: AuthWorld) {
  await this.cleanupUsers()
  await this.closeBrowser()
})
