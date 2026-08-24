import type { PreSignUpTriggerEvent } from 'aws-lambda'

/**
 * Cognito pre-sign-up trigger. Unconditionally auto-confirms every new
 * account and marks its email pre-verified -- Cognito's own signup-
 * verification email is suppressed entirely, since auth-api now owns
 * generating, storing, and emailing that code itself (see
 * shared/verificationCodes.ts). This flips the account to CONFIRMED
 * instantly; auth-api's own login gate (handlers/password.ts) blocks
 * sign-in until the app-owned code is verified.
 */
export async function handler(event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> {
  event.response.autoConfirmUser = true
  event.response.autoVerifyEmail = true
  return event
}
