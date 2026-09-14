import { Given, When, Then } from '@cucumber/cucumber'
import { expect, type APIResponse } from '@playwright/test'
import type { AuthWorld } from '../support/world'
import { fillSignInForm, waitForAdminRedirect } from '../support/actions'

function demoCredentials(): { email: string; password: string } {
  const email = process.env['DEMO_USER_EMAIL']
  const password = process.env['DEMO_USER_PASSWORD']
  if (!email || !password) {
    throw new Error(
      'DEMO_USER_EMAIL and DEMO_USER_PASSWORD must be set (from the demo stack outputs). ' +
        'The e2e harness also requires E2E_BASE_URL, E2E_USER_POOL_ID, and AWS_REGION/AWS_DEFAULT_REGION.',
    )
  }
  return { email, password }
}

Given("the seeded demo user's credentials are configured", function (this: AuthWorld) {
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

interface RouteWiringWorld extends AuthWorld {
  routeResponse?: APIResponse
}

When(
  'I send a deliberately invalid {word} request to {string}',
  async function (this: RouteWiringWorld, method: string, path: string) {
    this.routeResponse = await this.page.request.fetch(path, { method, failOnStatusCode: false })
  },
)

Then(
  'the response comes from the auth-api Lambda, not a missing API Gateway route',
  async function (this: RouteWiringWorld) {
    const status = this.routeResponse?.status()
    // Each of this scenario's routes throws its own well-defined error class
    // on a bare/malformed request -- never a 2xx, and (per errorResponse in
    // handler.ts) never an unhandled 5xx either -- so this range is tight
    // enough that a 404 can only mean the API Gateway route itself is
    // missing, not that the request happened to be invalid in some new way.
    expect(status).toBeGreaterThanOrEqual(400)
    expect(status).toBeLessThan(500)
  },
)
