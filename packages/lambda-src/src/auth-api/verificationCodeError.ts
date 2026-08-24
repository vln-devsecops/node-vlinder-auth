import type { VerifyCodeResult } from '../shared/verificationCodes'

// registration.ts and recovery.ts both confirm a submitted code against
// shared/verificationCodes.ts's verifyCode(); this maps its non-success
// outcomes to the friendly, first-party error the caller sees.

export class InvalidVerificationCodeError extends Error {}

const MESSAGES: Record<Exclude<VerifyCodeResult, 'success'>, string> = {
  invalid: 'Incorrect verification code.',
  'locked-out': 'Too many incorrect attempts. Request a new code.',
  'not-found': 'No pending verification code found for this address. Request a new code.',
}

/** No-op on 'success'; throws {@link InvalidVerificationCodeError} otherwise. */
export function assertVerified(result: VerifyCodeResult): void {
  if (result === 'success') {
    return
  }
  throw new InvalidVerificationCodeError(MESSAGES[result])
}
