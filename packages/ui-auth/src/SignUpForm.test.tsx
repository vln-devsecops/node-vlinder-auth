import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SignUpForm } from './SignUpForm'

describe('SignUpForm', () => {
  it('renders email, name, password, and confirm-password fields', () => {
    render(<SignUpForm onSubmit={vi.fn()} />)

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument()
  })

  it('shows validation errors and does not submit when fields are empty', async () => {
    const onSubmit = vi.fn()
    render(<SignUpForm onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: /sign up/i }))

    expect(await screen.findByText(/email is required/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects a missing first name', async () => {
    const onSubmit = vi.fn()
    render(<SignUpForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'correct-horse-battery')
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'correct-horse-battery')
    await userEvent.click(screen.getByRole('button', { name: /sign up/i }))

    expect(await screen.findByText(/first name is required/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects a password shorter than 8 characters', async () => {
    const onSubmit = vi.fn()
    render(<SignUpForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await userEvent.type(screen.getByLabelText(/first name/i), 'Jane')
    await userEvent.type(screen.getByLabelText(/last name/i), 'Doe')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'short')
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'short')
    await userEvent.click(screen.getByRole('button', { name: /sign up/i }))

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects mismatched password confirmation', async () => {
    const onSubmit = vi.fn()
    render(<SignUpForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await userEvent.type(screen.getByLabelText(/first name/i), 'Jane')
    await userEvent.type(screen.getByLabelText(/last name/i), 'Doe')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'correct-horse-battery')
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'different-password')
    await userEvent.click(screen.getByRole('button', { name: /sign up/i }))

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('calls onSubmit with the email and password when the form is valid', async () => {
    const onSubmit = vi.fn()
    render(<SignUpForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await userEvent.type(screen.getByLabelText(/first name/i), 'Jane')
    await userEvent.type(screen.getByLabelText(/last name/i), 'Doe')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'correct-horse-battery')
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'correct-horse-battery')
    await userEvent.click(screen.getByRole('button', { name: /sign up/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      email: 'jane@example.com',
      password: 'correct-horse-battery',
      givenName: 'Jane',
      familyName: 'Doe',
    })
  })

  it('applies the resolved theme primary color to the submit button', () => {
    render(<SignUpForm onSubmit={vi.fn()} theme={{ primaryColor: '#ff0000' }} />)

    const button = screen.getByRole('button', { name: /sign up/i })
    expect(button).toHaveStyle({ backgroundColor: '#ff0000' })
  })
})
