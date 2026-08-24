import type { PreSignUpTriggerEvent } from 'aws-lambda'
import { describe, expect, it } from 'vitest'
import { handler } from './handler'

function buildEvent(
  overrides: Partial<PreSignUpTriggerEvent> = {},
): PreSignUpTriggerEvent {
  return {
    version: '1',
    region: 'us-east-1',
    userPoolId: 'us-east-1_example',
    userName: 'jane@example.com',
    callerContext: { awsSdkVersion: '', clientId: '' },
    triggerSource: 'PreSignUp_SignUp',
    request: {
      userAttributes: { email: 'jane@example.com' },
    },
    response: {
      autoConfirmUser: false,
      autoVerifyEmail: false,
      autoVerifyPhone: false,
    },
    ...overrides,
  } as PreSignUpTriggerEvent
}

describe('pre-sign-up handler', () => {
  it('always auto-confirms the user and auto-verifies their email', async () => {
    const result = await handler(buildEvent())

    expect(result.response.autoConfirmUser).toBe(true)
    expect(result.response.autoVerifyEmail).toBe(true)
  })

  it('auto-confirms regardless of trigger source', async () => {
    const result = await handler(buildEvent({ triggerSource: 'PreSignUp_AdminCreateUser' }))

    expect(result.response.autoConfirmUser).toBe(true)
    expect(result.response.autoVerifyEmail).toBe(true)
  })
})
