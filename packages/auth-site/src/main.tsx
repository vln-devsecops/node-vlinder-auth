import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import {
  SignInFlow,
  SignUpForm,
  ForgotPasswordForm,
  VerifyEmailNotice,
  ConfirmSignUpForm,
  AuthChrome,
  themeFromProfile,
  resolveProfile,
  type AuthProfile,
  type BuiltinProfileName,
} from '@vln-devsecops/auth-ui'
import { saveSession } from './session'
import { loadConfig } from './config'

type Page = 'signin' | 'signup' | 'forgot' | 'verify'

// The SPA speaks only this first-party surface -- no ClientId, no X-Amz-Target,
// no Cognito envelopes. The backend (auth Lambda) owns all Cognito interaction.
const AUTH_URL = '/api/v1/auth'

async function authErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  return body.error ?? `${fallback}: ${response.status}`
}

/** POST a JSON payload to an /api/v1/auth endpoint; throw its error message on failure. */
async function postAuth(
  path: string,
  payload: Record<string, unknown>,
  fallback: string,
): Promise<void> {
  const response = await fetch(`${AUTH_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(await authErrorMessage(response, fallback))
  }
}

/**
 * Vendor-neutral, identifier-first sign-in. Step 1: resolve the identifier to
 * how it authenticates (the backend does home-realm discovery). The SPA never
 * speaks to the identity provider directly -- see doc/vendor-neutral-auth.md.
 */
async function identify(
  identifier: string,
): Promise<{ method: 'password' | 'redirect'; location?: string }> {
  const response = await fetch(`${AUTH_URL}/identify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ identifier }),
  })
  if (!response.ok) {
    throw new Error(await authErrorMessage(response, 'Sign-in failed'))
  }
  return (await response.json()) as { method: 'password' | 'redirect'; location?: string }
}

/**
 * Step 2 (local accounts): submit the password; the identifier rides its cookie.
 * On success the backend sets the auth token as an HttpOnly cookie and returns
 * only when the session expires -- the SPA never sees the token itself.
 */
async function submitPassword(password: string): Promise<{ expiresAt: number }> {
  const response = await fetch(`${AUTH_URL}/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ password }),
  })
  if (!response.ok) {
    throw new Error(await authErrorMessage(response, 'Sign-in failed'))
  }
  return (await response.json()) as { expiresAt: number }
}

const signUp = (values: {
  email: string
  password: string
  givenName: string
  familyName: string
}) => postAuth('/signup', values, 'Sign-up failed')

const confirmSignUp = (email: string, code: string) =>
  postAuth('/confirm', { email, code }, 'Verification failed')

const resendConfirmationCode = (email: string) => postAuth('/resend', { email }, 'Resend failed')

const requestForgotPassword = (email: string) => postAuth('/forgot', { email }, 'Request failed')

const confirmForgotPassword = (values: { email: string; code: string; newPassword: string }) =>
  postAuth('/reset', values, 'Reset failed')

function App() {
  const [page, setPage] = useState<Page>('signin')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingEmail, setPendingEmail] = useState('')
  // Defaults true (pre-profile behavior) so a not-yet-resolved config never
  // blocks the redirect a user expects; loadConfig() resolves long before a
  // real login submission completes.
  const [adminEnabled, setAdminEnabled] = useState(true)
  // Defaults to AuthChrome's own generic profile until config.json resolves.
  const [profile, setProfile] = useState<BuiltinProfileName | AuthProfile>('default')

  useEffect(() => {
    loadConfig()
      .then((config) => {
        setAdminEnabled(config.adminEnabled)
        setProfile(config.profile)
      })
      .catch(() => undefined)
  }, [])

  const theme = themeFromProfile(resolveProfile(profile))

  const handleIdentify = (identifier: string) => {
    setError(null)
    return identify(identifier)
  }

  const handlePassword = async (_identifier: string, password: string) => {
    setError(null)
    const session = await submitPassword(password)
    saveSession(session)
    if (adminEnabled) {
      window.location.href = '/admin'
    } else {
      setNotice('Signed in.')
    }
  }

  const handleSignUp = async (values: {
    email: string
    password: string
    givenName: string
    familyName: string
  }) => {
    setError(null)
    try {
      await signUp(values)
      setPendingEmail(values.email)
      setPage('verify')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sign-up failed')
    }
  }

  const handleConfirmSignUp = async (code: string) => {
    setError(null)
    try {
      await confirmSignUp(pendingEmail, code)
      setNotice('Email verified. You can sign in now.')
      setPage('signin')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Verification failed')
    }
  }

  const handleRequestCode = async (email: string) => {
    setError(null)
    setPendingEmail(email)
    try {
      await requestForgotPassword(email)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Request failed')
    }
  }

  const handleConfirmReset = async (values: {
    email: string
    code: string
    newPassword: string
  }) => {
    setError(null)
    try {
      await confirmForgotPassword(values)
      setPage('signin')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Reset failed')
    }
  }

  const footer = (() => {
    switch (page) {
      case 'signin':
        return (
          <>
            <button type="button" onClick={() => { setError(null); setPage('signup') }}>Create account</button>
            <button type="button" onClick={() => { setError(null); setPage('forgot') }}>Forgot password?</button>
          </>
        )
      case 'signup':
      case 'forgot':
        return (
          <button type="button" onClick={() => { setError(null); setPage('signin') }}>Back to sign in</button>
        )
      case 'verify':
        return undefined
    }
  })()

  return (
    <AuthChrome
      profile={profile}
      banner={
        <>
          {error && <p role="alert">{error}</p>}
          {notice && <output>{notice}</output>}
        </>
      }
      footer={footer}
    >
      {page === 'signin' && (
        <SignInFlow
          onIdentify={handleIdentify}
          onPassword={handlePassword}
          onError={setError}
          theme={theme}
        />
      )}

      {page === 'signup' && <SignUpForm onSubmit={handleSignUp} theme={theme} />}

      {page === 'forgot' && (
        <ForgotPasswordForm
          onRequestCode={handleRequestCode}
          onConfirmReset={handleConfirmReset}
          theme={theme}
        />
      )}

      {page === 'verify' && (
        <>
          <VerifyEmailNotice
            email={pendingEmail}
            onResend={() => resendConfirmationCode(pendingEmail)}
            theme={theme}
          />
          <ConfirmSignUpForm onConfirm={handleConfirmSignUp} theme={theme} />
        </>
      )}
    </AuthChrome>
  )
}

const container = document.getElementById('app')!
createRoot(container).render(<App />)
