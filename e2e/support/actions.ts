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
