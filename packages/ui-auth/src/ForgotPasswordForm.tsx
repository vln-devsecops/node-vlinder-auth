import { useState, type FormEvent } from 'react'
import { resolveTheme, type VlinderAuthTheme } from './theme'

export interface ConfirmResetValues {
  email: string
  code: string
  newPassword: string
}

export interface ForgotPasswordFormProps {
  onRequestCode: (email: string) => void | Promise<void>
  onConfirmReset: (values: ConfirmResetValues) => void | Promise<void>
  theme?: Partial<VlinderAuthTheme>
}

const MIN_PASSWORD_LENGTH = 8

/** Two-step flow: request a reset code, then confirm it with a new password. */
export function ForgotPasswordForm(props: ForgotPasswordFormProps) {
  const theme = resolveTheme(props.theme)
  const [step, setStep] = useState<'request' | 'confirm'>('request')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)

  const handleRequestCode = (event: FormEvent): void => {
    event.preventDefault()
    void props.onRequestCode(email)
    setStep('confirm')
  }

  const handleConfirmReset = (event: FormEvent): void => {
    event.preventDefault()
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    setError(undefined)
    void props.onConfirmReset({ email, code, newPassword })
  }

  if (step === 'request') {
    return (
      <form onSubmit={handleRequestCode} style={{ fontFamily: theme.fontFamily }}>
        <label htmlFor="forgot-password-email">Email</label>
        <input
          id="forgot-password-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button type="submit" style={{ backgroundColor: theme.primaryColor }}>
          Send reset code
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleConfirmReset} style={{ fontFamily: theme.fontFamily }}>
      <label htmlFor="forgot-password-code">Confirmation code</label>
      <input
        id="forgot-password-code"
        type="text"
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />

      <label htmlFor="forgot-password-new-password">New password</label>
      <input
        id="forgot-password-new-password"
        type="password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
      />

      {error && <p role="alert">{error}</p>}

      <button type="submit" style={{ backgroundColor: theme.primaryColor }}>
        Reset password
      </button>
    </form>
  )
}
