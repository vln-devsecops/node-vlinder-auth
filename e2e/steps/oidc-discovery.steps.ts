import { Then } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { decodeJwtPayload, getSessionAccessToken } from '../support/actions'
import type { AuthWorld } from '../support/world'

Then(
  "the discovery document's issuer matches my session token's issuer",
  async function (this: AuthWorld) {
    const token = await getSessionAccessToken(this)
    const claims = decodeJwtPayload(token)

    const response = await this.page.request.get('/.well-known/openid-configuration')
    expect(response.ok()).toBe(true)
    const document = (await response.json()) as { issuer: string }

    // The whole point of the discovery document: a resource server pins
    // against its published issuer, never a token's own iss claim taken at
    // face value. This confirms the two currently agree against a real
    // deployment, not a constant baked into the test.
    expect(claims.iss).toBe(document.issuer)
  },
)
