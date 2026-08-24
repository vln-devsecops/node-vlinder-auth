import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2'

export type VerificationPurpose = 'signup' | 'password-reset'

const SUBJECTS: Record<VerificationPurpose, string> = {
  signup: 'Verify your email address',
  'password-reset': 'Reset your password',
}

const BODIES: Record<VerificationPurpose, (code: string) => string> = {
  signup: (code) => `Your verification code is ${code}. It expires shortly.`,
  'password-reset': (code) => `Your password reset code is ${code}. It expires shortly.`,
}

export interface SendVerificationCodeParams {
  email: string
  code: string
  purpose: VerificationPurpose
  sesClient: SESv2Client
  fromAddress: string
}

export async function sendVerificationCode(params: SendVerificationCodeParams): Promise<void> {
  const { email, code, purpose, sesClient, fromAddress } = params

  await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: fromAddress,
      Destination: { ToAddresses: [email] },
      Content: {
        Simple: {
          Subject: { Data: SUBJECTS[purpose] },
          Body: { Text: { Data: BODIES[purpose](code) } },
        },
      },
    }),
  )
}
