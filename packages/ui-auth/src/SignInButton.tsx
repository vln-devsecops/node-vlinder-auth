import { useAuth } from 'react-oidc-context'
import { resolveTheme, type VlinderAuthTheme } from './theme'

export interface SignInButtonProps {
  theme?: Partial<VlinderAuthTheme>
  label?: string
}

/** Thin wrapper over react-oidc-context's useAuth -- the consuming app supplies its own AuthProvider. */
export function SignInButton(props: SignInButtonProps) {
  const auth = useAuth()
  const theme = resolveTheme(props.theme)

  return (
    <button
      onClick={() => auth.signinRedirect()}
      style={{ backgroundColor: theme.primaryColor, color: theme.backgroundColor }}
    >
      {props.label ?? 'Sign in'}
    </button>
  )
}
