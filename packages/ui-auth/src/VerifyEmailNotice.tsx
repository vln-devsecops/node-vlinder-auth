import { useState } from 'react'
import { resolveTheme, type VlinderAuthTheme } from './theme'

export interface VerifyEmailNoticeProps {
  email: string
  onResend: () => void | Promise<void>
  theme?: Partial<VlinderAuthTheme>
}

export function VerifyEmailNotice(props: Readonly<VerifyEmailNoticeProps>) {
  const theme = resolveTheme(props.theme)
  const [resent, setResent] = useState(false)

  const handleResend = (): void => {
    void props.onResend()
    setResent(true)
  }

  return (
    <div style={{ fontFamily: theme.fontFamily }}>
      <p>
        We sent a verification code to <strong>{props.email}</strong>. Enter it below to
        finish signing up.
      </p>
      <button
        type="button"
        onClick={handleResend}
        style={{ backgroundColor: theme.primaryColor }}
      >
        Resend email
      </button>
      {resent && <output>Verification email resent.</output>}
    </div>
  )
}
