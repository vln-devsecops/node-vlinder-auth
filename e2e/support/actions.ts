import type { AuthWorld } from './world'

export async function fillSignInForm(world: AuthWorld, email: string, password: string): Promise<void> {
  // Identifier-first, two-step sign-in: identifier, then (for a local account)
  // the password revealed by the identify step.
  await world.page.getByLabel('Email or username').fill(email)
  await world.page.getByRole('button', { name: 'Continue' }).click()
  await world.page.getByLabel('Password').fill(password)
  await world.page.getByRole('button', { name: 'Sign in' }).click()
}

/**
 * Waits for the post-sign-in redirect to /admin. On failure, checks for a
 * visible role="alert" error (the SPA shows one instead of redirecting on
 * a failed sign-in) and surfaces its text -- a real API/parsing failure
 * should never just look like an unexplained timeout in CI logs.
 */
export async function waitForAdminRedirect(world: AuthWorld): Promise<void> {
  try {
    await world.page.waitForURL('**/admin', { timeout: 15000 })
  } catch (err) {
    const alertText = await world.page
      .getByRole('alert')
      .textContent()
      .catch(() => null)
    if (alertText) {
      throw new Error(`Sign-in did not redirect; page showed: "${alertText}"`, { cause: err })
    }
    throw err
  }
}

/**
 * Decodes a JWT's payload without verifying its signature -- fine here,
 * where the point is comparing one already-trusted claim against the
 * published discovery document, not validating the token itself (that's the
 * JWT authorizer's job in real request paths).
 */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  if (!payload) {
    throw new Error('Not a JWT: no payload segment')
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
}

/**
 * Reads the AS session cookie set after a successful sign-in -- this is the
 * raw Cognito access token, HttpOnly so the SPA's own JS never touches it.
 * Cookie name must match auth-api/session.ts's AS_SESSION_COOKIE.
 */
export async function getSessionAccessToken(world: AuthWorld): Promise<string> {
  const cookies = await world.context.cookies()
  const session = cookies.find((cookie) => cookie.name === 'vln_auth_session')
  if (!session) {
    throw new Error('No vln_auth_session cookie found -- sign-in must complete first')
  }
  return session.value
}
