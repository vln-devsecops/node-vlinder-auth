import { Then, When } from '@cucumber/cucumber'
import { expect, type APIResponse } from '@playwright/test'
import { decodeJwtPayload, getSessionAccessToken } from '../support/actions'
import type { AuthWorld } from '../support/world'

interface DiscoveryWorld extends AuthWorld {
  discoveryResponse?: APIResponse
}

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

When('I fetch the discovery document', async function (this: DiscoveryWorld) {
  this.discoveryResponse = await this.page.request.get('/.well-known/openid-configuration')
})

Then(/^it is served with an application\/json content type$/, async function (this: DiscoveryWorld) {
  // Extensionless-by-specification paths don't get a free ride from S3's
  // extension-based Content-Type guessing (that's exactly what broke this
  // once -- aws s3 sync left it as binary/octet-stream). Several strict
  // OIDC client libraries reject a discovery document served as anything
  // else, independent of the JSON body being well-formed.
  expect(this.discoveryResponse?.ok()).toBe(true)
  expect(this.discoveryResponse?.headers()['content-type']).toContain('application/json')
})
