import { createRoot } from 'react-dom/client'
import { useState, useEffect } from 'react'
import {
  SignInButton,
  SignUpForm,
  ForgotPasswordForm,
  VerifyEmailNotice,
} from '@vln-devsecops/auth-ui'
import { buildInitiateAuthBody, parseAuthResult } from './authConfig'
import { saveTokens } from './session'
import { loadConfig, type SiteConfig } from './config'

type Page = 'signin' | 'signup' | 'forgot' | 'verify'

const IDP_URL = '/idp'

async function signIn(
  clientId: string,
  email: string,
  password: string,
): Promise<ReturnType<typeof parseAuthResult>> {
  const response = await fetch(IDP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify(buildInitiateAuthBody(clientId, email, password)),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(body.message ?? `Sign-in failed: ${response.status}`)
  }
  return parseAuthResult((await response.json()) as Record<string, Record<string, unknown>>)
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

  const handleSignIn = async (values: { email: string; password: string }) => {
    setError(null)
    try {
      const tokens = await signIn(config.userPoolClientId, values.email, values.password)
      saveTokens(tokens)
      window.location.href = '/admin'
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
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

      {page === 'signin' && (
        <>
          <SignInButton onSubmit={handleSignIn} />
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
        <VerifyEmailNotice email={pendingEmail} onResend={() => requestForgotPassword(config.userPoolClientId, pendingEmail)} />
      )}
    </div>
  )
}

const container = document.getElementById('app')!
createRoot(container).render(<App />)
