import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SignInButton } from './SignInButton'

describe('SignInButton', () => {
  it('calls onSubmit with email and password when the form is submitted', async () => {
    const onSubmit = vi.fn()
    render(<SignInButton onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'secret123')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(onSubmit).toHaveBeenCalledWith({ email: 'user@example.com', password: 'secret123' })
  })

  it('supports a custom label', () => {
    render(<SignInButton onSubmit={vi.fn()} label="Log in to Acme" />)
    expect(screen.getByRole('button', { name: 'Log in to Acme' })).toBeInTheDocument()
  })

  it('applies the resolved theme primary color to the submit button', () => {
    render(<SignInButton onSubmit={vi.fn()} theme={{ primaryColor: '#00ff00' }} />)
    expect(screen.getByRole('button')).toHaveStyle({ backgroundColor: '#00ff00' })
  })
})
