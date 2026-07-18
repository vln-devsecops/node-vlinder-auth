import { createRoot } from 'react-dom/client'
import { useState, useEffect } from 'react'
import {
  SignInFlow,
  SignUpForm,
  ForgotPasswordForm,
  VerifyEmailNotice,
  ConfirmSignUpForm,
} from '@vln-devsecops/auth-ui'
import type { CognitoTokens } from './authConfig'
import { saveTokens } from './session'
import { loadConfig, type SiteConfig } from './config'

type Page = 'signin' | 'signup' | 'forgot' | 'verify'

const IDP_URL = '/api/v1/idp'
const AUTH_URL = '/api/v1/auth'

async function authErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  return body.error ?? `${fallback}: ${response.status}`
}

/**
 * Vendor-neutral, identifier-first sign-in. Step 1: resolve the identifier to
 * how it authenticates (the backend does home-realm discovery). The SPA never
 * speaks to the identity provider directly -- see doc/vendor-neutral-auth.md.
 */
async function identify(identifier: string): Promise<{ method: 'password' | 'redirect'; location?: string }> {
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

/** Step 2 (local accounts): submit the password; the identifier rides its cookie. */
async function submitPassword(password: string): Promise<CognitoTokens> {
  const response = await fetch(`${AUTH_URL}/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ password }),
  })
  if (!response.ok) {
    throw new Error(await authErrorMessage(response, 'Sign-in failed'))
  }
  const body = (await response.json()) as { tokens: CognitoTokens }
  return body.tokens
}

async function signUp(
  clientId: string,
  email: string,
  password: string,
  givenName: string,
  familyName: string,
): Promise<void> {
  const response = await fetch(IDP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.SignUp',
    },
    body: JSON.stringify({
      ClientId: clientId,
      Username: email,
      Password: password,
      // given_name/family_name are required attributes in cognito_auth's
      // user pool schema (doxchange-derived) -- SignUp is rejected without
      // them.
      UserAttributes: [
        { Name: 'given_name', Value: givenName },
        { Name: 'family_name', Value: familyName },
      ],
    }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(body.message ?? `Sign-up failed: ${response.status}`)
  }
}

async function confirmSignUp(clientId: string, email: string, code: string): Promise<void> {
  const response = await fetch(IDP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.ConfirmSignUp',
    },
    body: JSON.stringify({ ClientId: clientId, Username: email, ConfirmationCode: code }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(body.message ?? `Verification failed: ${response.status}`)
  }
}

async function resendConfirmationCode(clientId: string, email: string): Promise<void> {
  const response = await fetch(IDP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.ResendConfirmationCode',
    },
    body: JSON.stringify({ ClientId: clientId, Username: email }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(body.message ?? `Resend failed: ${response.status}`)
  }
}

async function requestForgotPassword(clientId: string, email: string): Promise<void> {
  const response = await fetch(IDP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.ForgotPassword',
    },
    body: JSON.stringify({ ClientId: clientId, Username: email }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(body.message ?? `Request failed: ${response.status}`)
  }
}

async function confirmForgotPassword(
  clientId: string,
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  const response = await fetch(IDP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.ConfirmForgotPassword',
    },
    body: JSON.stringify({
      ClientId: clientId,
      Username: email,
      ConfirmationCode: code,
      Password: newPassword,
    }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(body.message ?? `Reset failed: ${response.status}`)
  }
}

function App() {
  const [page, setPage] = useState<Page>('signin')
  const [config, setConfig] = useState<SiteConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingEmail, setPendingEmail] = useState('')

  useEffect(() => {
    loadConfig()
      .then(setConfig)
      .catch((e: unknown) => {
        setConfigError(e instanceof Error ? e.message : 'Failed to load config')
      })
  }, [])

  if (configError) {
    return <p role="alert">{configError}</p>
  }
  if (!config) {
    return <p>Loading…</p>
  }

  const handleIdentify = (identifier: string) => {
    setError(null)
    return identify(identifier)
  }

  const handlePassword = async (_identifier: string, password: string) => {
    setError(null)
    const tokens = await submitPassword(password)
    saveTokens(tokens)
    window.location.href = '/admin'
  }

  const handleSignUp = async (values: {
    email: string
    password: string
    givenName: string
    familyName: string
  }) => {
    setError(null)
    try {
      await signUp(
        config.userPoolClientId,
        values.email,
        values.password,
        values.givenName,
        values.familyName,
      )
      setPendingEmail(values.email)
      setPage('verify')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sign-up failed')
    }
  }

  const handleConfirmSignUp = async (code: string) => {
    setError(null)
    try {
      await confirmSignUp(config.userPoolClientId, pendingEmail, code)
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
      await requestForgotPassword(config.userPoolClientId, email)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Request failed')
    }
  }

  const handleConfirmReset = async (values: { email: string; code: string; newPassword: string }) => {
    setError(null)
    try {
      await confirmForgotPassword(
        config.userPoolClientId,
        values.email,
        values.code,
        values.newPassword,
      )
      setPage('signin')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Reset failed')
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {page === 'signin' && (
        <>
          <SignInFlow onIdentify={handleIdentify} onPassword={handlePassword} onError={setError} />
          <button onClick={() => { setError(null); setPage('signup') }}>Create account</button>
          <button onClick={() => { setError(null); setPage('forgot') }}>Forgot password?</button>
        </>
      )}

      {page === 'signup' && (
        <>
          <SignUpForm onSubmit={handleSignUp} />
          <button onClick={() => { setError(null); setPage('signin') }}>Back to sign in</button>
        </>
      )}

      {page === 'forgot' && (
        <>
          <ForgotPasswordForm
            onRequestCode={handleRequestCode}
            onConfirmReset={handleConfirmReset}
          />
          <button onClick={() => { setError(null); setPage('signin') }}>Back to sign in</button>
        </>
      )}

      {page === 'verify' && (
        <>
          <VerifyEmailNotice
            email={pendingEmail}
            onResend={() => resendConfirmationCode(config.userPoolClientId, pendingEmail)}
          />
          <ConfirmSignUpForm onConfirm={handleConfirmSignUp} />
        </>
      )}
    </div>
  )
}

const container = document.getElementById('app')!
createRoot(container).render(<App />)
