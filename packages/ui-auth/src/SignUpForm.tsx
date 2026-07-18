import { useState, type FormEvent } from 'react'
import { resolveTheme, type VlinderAuthTheme } from './theme'

export interface SignUpFormValues {
  email: string
  password: string
  givenName: string
  familyName: string
}

export interface SignUpFormProps {
  onSubmit: (values: SignUpFormValues) => void | Promise<void>
  theme?: Partial<VlinderAuthTheme>
}

const MIN_PASSWORD_LENGTH = 8

function validate(
  email: string,
  password: string,
  confirmPassword: string,
  givenName: string,
  familyName: string,
): string | undefined {
  if (!email.trim()) {
    return 'Email is required.'
  }
  // given_name/family_name are required attributes in vlinder_auth's user
  // pool schema (doxchange-derived contract) -- Cognito rejects a SignUp
  // without them, so catch it client-side with a friendlier message.
  if (!givenName.trim()) {
    return 'First name is required.'
  }
  if (!familyName.trim()) {
    return 'Last name is required.'
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
  const [givenName, setGivenName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    const validationError = validate(email, password, confirmPassword, givenName, familyName)
    setError(validationError)
    if (!validationError) {
      void props.onSubmit({ email, password, givenName, familyName })
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

      <label htmlFor="signup-given-name">First name</label>
      <input
        id="signup-given-name"
        type="text"
        autoComplete="given-name"
        value={givenName}
        onChange={(event) => setGivenName(event.target.value)}
      />

      <label htmlFor="signup-family-name">Last name</label>
      <input
        id="signup-family-name"
        type="text"
        autoComplete="family-name"
        value={familyName}
        onChange={(event) => setFamilyName(event.target.value)}
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
