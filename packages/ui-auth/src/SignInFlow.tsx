import { useState, type FormEvent } from 'react'
import { resolveTheme, type VlinderAuthTheme } from './theme'

/** How the backend says a resolved identifier should authenticate. */
export interface IdentifyResult {
  method: 'password' | 'redirect'
  /** For `redirect`: the (same-origin) URL to navigate to, which 302s to the IdP. */
  location?: string
}

export interface SignInFlowProps {
  /** Resolve an identifier to how it authenticates (backend home-realm discovery). */
  onIdentify: (identifier: string) => Promise<IdentifyResult>
  /** Complete a password sign-in for the resolved identifier. */
  onPassword: (identifier: string, password: string) => void | Promise<void>
  /** Navigate for a federated identifier. Defaults to setting window.location. */
  onRedirect?: (location: string) => void
  /** Surface an error message (the host app renders it). */
  onError?: (message: string) => void
  theme?: Partial<VlinderAuthTheme>
}

/**
 * Identifier-first sign-in. Step 1 collects an identifier and asks the backend
 * how it authenticates; step 2 (for local accounts) collects the password.
 * A federated identifier resolves to a redirect instead. The SPA never speaks
 * to the identity provider directly -- see doc/vendor-neutral-auth.md.
 */
export function SignInFlow(props: SignInFlowProps) {
  const theme = resolveTheme(props.theme)
  const [step, setStep] = useState<'identifier' | 'password'>('identifier')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const buttonStyle = { backgroundColor: theme.primaryColor, color: theme.backgroundColor }

  const fail = (error: unknown): void => {
    props.onError?.(error instanceof Error ? error.message : 'Sign-in failed')
  }

  const handleIdentify = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await props.onIdentify(identifier)
      if (result.method === 'redirect' && result.location) {
        const redirect = props.onRedirect ?? ((location) => (window.location.href = location))
        redirect(result.location)
        return
      }
      setStep('password')
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  }

  const handlePassword = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    try {
      await props.onPassword(identifier, password)
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  }

  if (step === 'password') {
    return (
      <form onSubmit={handlePassword} style={{ fontFamily: theme.fontFamily }}>
        <p data-identifier>{identifier}</p>
        <button
          type="button"
          onClick={() => {
            setPassword('')
            setStep('identifier')
          }}
        >
          Use a different account
        </button>

        <label htmlFor="signin-password">Password</label>
        <input
          id="signin-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          autoFocus
        />

        <button type="submit" disabled={busy} style={buttonStyle}>
          Sign in
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleIdentify} style={{ fontFamily: theme.fontFamily }}>
      <label htmlFor="signin-identifier">Email or username</label>
      <input
        id="signin-identifier"
        type="text"
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        required
        autoFocus
      />

      <button type="submit" disabled={busy} style={buttonStyle}>
        Continue
      </button>
    </form>
  )
}
