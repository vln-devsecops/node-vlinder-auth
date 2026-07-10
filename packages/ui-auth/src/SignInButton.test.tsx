import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const signinRedirectMock = vi.fn()

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({ signinRedirect: signinRedirectMock }),
}))

const { SignInButton } = await import('./SignInButton')

describe('SignInButton', () => {
  it('calls signinRedirect from the oidc auth context when clicked', async () => {
    render(<SignInButton />)

    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(signinRedirectMock).toHaveBeenCalled()
  })

  it('supports a custom label', () => {
    render(<SignInButton label="Log in to Acme" />)
    expect(screen.getByRole('button', { name: 'Log in to Acme' })).toBeInTheDocument()
  })

  it('applies the resolved theme primary color', () => {
    render(<SignInButton theme={{ primaryColor: '#00ff00' }} />)
    expect(screen.getByRole('button')).toHaveStyle({ backgroundColor: '#00ff00' })
  })
})
