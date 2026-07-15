import { useState, type FormEvent } from 'react'
import { resolveTheme, type VlinderAuthTheme } from './theme'

export interface ConfirmSignUpFormProps {
  onConfirm: (code: string) => void | Promise<void>
  theme?: Partial<VlinderAuthTheme>
}

/**
 * Code-entry form completing a code-based signup confirmation (the pool
 * uses CONFIRM_WITH_CODE -- link-based confirmation needs a Cognito hosted
 * domain, which cognito_auth deliberately doesn't create). The consuming
 * app calls ConfirmSignUp in onConfirm.
 */
export function ConfirmSignUpForm(props: ConfirmSignUpFormProps) {
  const theme = resolveTheme(props.theme)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!code.trim()) {
      setError('Verification code is required.')
      return
    }
    setError(undefined)
    void props.onConfirm(code.trim())
  }

  return (
    <form onSubmit={handleSubmit} style={{ fontFamily: theme.fontFamily }}>
      <label htmlFor="confirm-signup-code">Verification code</label>
      <input
        id="confirm-signup-code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />

      {error && <p role="alert">{error}</p>}

      <button
        type="submit"
        style={{ backgroundColor: theme.primaryColor, color: theme.backgroundColor }}
      >
        Verify
      </button>
    </form>
  )
}
