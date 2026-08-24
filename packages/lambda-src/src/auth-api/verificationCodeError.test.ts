import { describe, expect, it } from 'vitest'
import { assertVerified, InvalidVerificationCodeError } from './verificationCodeError'

describe('assertVerified', () => {
  it('does nothing on success', () => {
    expect(() => assertVerified('success')).not.toThrow()
  })

  it.each([
    ['invalid', 'Incorrect verification code.'],
    ['locked-out', 'Too many incorrect attempts. Request a new code.'],
    ['not-found', 'No pending verification code found for this address. Request a new code.'],
  ] as const)('throws a friendly error for %s', (result, message) => {
    expect(() => assertVerified(result)).toThrow(InvalidVerificationCodeError)
    expect(() => assertVerified(result)).toThrow(message)
  })
})
