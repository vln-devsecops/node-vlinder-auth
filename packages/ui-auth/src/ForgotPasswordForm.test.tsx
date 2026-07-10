import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ForgotPasswordForm } from './ForgotPasswordForm'

describe('ForgotPasswordForm', () => {
  it('starts on the request-code step with just an email field', () => {
    render(<ForgotPasswordForm onRequestCode={vi.fn()} onConfirmReset={vi.fn()} />)

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/confirmation code/i)).not.toBeInTheDocument()
  })

  it('requests a code and advances to the confirm step', async () => {
    const onRequestCode = vi.fn()
    render(<ForgotPasswordForm onRequestCode={onRequestCode} onConfirmReset={vi.fn()} />)

    await userEvent.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send reset code/i }))

    expect(onRequestCode).toHaveBeenCalledWith('jane@example.com')
    expect(await screen.findByLabelText(/confirmation code/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/new password/i)).toBeInTheDocument()
  })

  it('rejects a new password shorter than 8 characters on the confirm step', async () => {
    const onConfirmReset = vi.fn()
    render(<ForgotPasswordForm onRequestCode={vi.fn()} onConfirmReset={onConfirmReset} />)

    await userEvent.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send reset code/i }))

    await userEvent.type(await screen.findByLabelText(/confirmation code/i), '123456')
    await userEvent.type(screen.getByLabelText(/new password/i), 'short')
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }))

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument()
    expect(onConfirmReset).not.toHaveBeenCalled()
  })

  it('calls onConfirmReset with email, code, and new password when valid', async () => {
    const onConfirmReset = vi.fn()
    render(<ForgotPasswordForm onRequestCode={vi.fn()} onConfirmReset={onConfirmReset} />)

    await userEvent.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send reset code/i }))

    await userEvent.type(await screen.findByLabelText(/confirmation code/i), '123456')
    await userEvent.type(screen.getByLabelText(/new password/i), 'correct-horse-battery')
    await userEvent.click(screen.getByRole('button', { name: /reset password/i }))

    expect(onConfirmReset).toHaveBeenCalledWith({
      email: 'jane@example.com',
      code: '123456',
      newPassword: 'correct-horse-battery',
    })
  })
})
