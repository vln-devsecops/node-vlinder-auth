import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { sendVerificationCode } from './email'

const sesMock = mockClient(SESv2Client)
const sesClient = sesMock as unknown as SESv2Client

beforeEach(() => {
  sesMock.reset()
})

describe('sendVerificationCode', () => {
  it('sends a signup verification email with the code and a signup-specific subject', async () => {
    sesMock.on(SendEmailCommand).resolves({})

    await sendVerificationCode({
      email: 'jane@x.com',
      code: '123456',
      purpose: 'signup',
      sesClient,
      fromAddress: 'no-reply@vlinder.example',
    })

    const call = sesMock.commandCalls(SendEmailCommand)[0].args[0].input
    expect(call.FromEmailAddress).toBe('no-reply@vlinder.example')
    expect(call.Destination).toEqual({ ToAddresses: ['jane@x.com'] })
    expect(call.Content?.Simple?.Subject?.Data).toBe('Verify your email address')
    expect(call.Content?.Simple?.Body?.Text?.Data).toContain('123456')
  })

  it('sends a password-reset email with a distinct subject', async () => {
    sesMock.on(SendEmailCommand).resolves({})

    await sendVerificationCode({
      email: 'jane@x.com',
      code: '654321',
      purpose: 'password-reset',
      sesClient,
      fromAddress: 'no-reply@vlinder.example',
    })

    const call = sesMock.commandCalls(SendEmailCommand)[0].args[0].input
    expect(call.Content?.Simple?.Subject?.Data).toBe('Reset your password')
    expect(call.Content?.Simple?.Body?.Text?.Data).toContain('654321')
  })
})
