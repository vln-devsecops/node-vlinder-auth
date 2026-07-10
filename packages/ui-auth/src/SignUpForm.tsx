import { useState, type FormEvent } from 'react'
import { resolveTheme, type VlinderAuthTheme } from './theme'

export interface SignUpFormValues {
  email: string
  password: string
}

export interface SignUpFormProps {
  onSubmit: (values: SignUpFormValues) => void | Promise<void>
  theme?: Partial<VlinderAuthTheme>
}

const MIN_PASSWORD_LENGTH = 8

function validate(email: string, password: string, confirmPassword: string): string | undefined {
  if (!email.trim()) {
    return 'Email is required.'
  }
  if (!password) {
    return 'Password is required.'
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (password !== confirmPassword) {
    return 'Passwords do not match.'
  }
  return undefined
}

/** Branded signup form. Client-side validation only; Cognito re-validates server-side regardless. */
export function SignUpForm(props: SignUpFormProps) {
  const theme = resolveTheme(props.theme)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    const validationError = validate(email, password, confirmPassword)
    setError(validationError)
    if (!validationError) {
      void props.onSubmit({ email, password })
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ fontFamily: theme.fontFamily }}>
      <label htmlFor="signup-email">Email</label>
      <input
        id="signup-email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <label htmlFor="signup-password">Password</label>
      <input
        id="signup-password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      <label htmlFor="signup-confirm-password">Confirm password</label>
      <input
        id="signup-confirm-password"
        type="password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
      />

      {error && <p role="alert">{error}</p>}

      <button
        type="submit"
        style={{ backgroundColor: theme.primaryColor, color: theme.backgroundColor }}
      >
        Sign up
      </button>
    </form>
  )
}
