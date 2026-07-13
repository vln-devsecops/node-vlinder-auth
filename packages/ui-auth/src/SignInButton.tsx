import { useState, type FormEvent } from 'react'
import { resolveTheme, type VlinderAuthTheme } from './theme'

export interface SignInButtonProps {
  onSubmit: (values: { email: string; password: string }) => void | Promise<void>
  theme?: Partial<VlinderAuthTheme>
  label?: string
}

/** Sign-in form that calls onSubmit with email and password for direct Cognito IDP API auth.
 * The consuming app is responsible for calling InitiateAuth (USER_PASSWORD_AUTH flow) in onSubmit. */
export function SignInButton(props: SignInButtonProps) {
  const theme = resolveTheme(props.theme)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    void props.onSubmit({ email, password })
  }

  return (
    <form onSubmit={handleSubmit} style={{ fontFamily: theme.fontFamily }}>
      <label htmlFor="signin-email">Email</label>
      <input
        id="signin-email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />

      <label htmlFor="signin-password">Password</label>
      <input
        id="signin-password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />

      <button
        type="submit"
        style={{ backgroundColor: theme.primaryColor, color: theme.backgroundColor }}
      >
        {props.label ?? 'Sign in'}
      </button>
    </form>
  )
}
