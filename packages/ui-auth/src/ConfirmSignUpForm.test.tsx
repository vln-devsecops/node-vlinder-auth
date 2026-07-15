import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmSignUpForm } from './ConfirmSignUpForm'

describe('ConfirmSignUpForm', () => {
  it('renders a verification-code field', () => {
    render(<ConfirmSignUpForm onConfirm={vi.fn()} />)

    expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument()
  })

  it('shows a validation error and does not submit when the code is empty', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmSignUpForm onConfirm={onConfirm} />)

    await userEvent.click(screen.getByRole('button', { name: /verify/i }))

    expect(await screen.findByText(/verification code is required/i)).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('calls onConfirm with the trimmed code', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmSignUpForm onConfirm={onConfirm} />)

    await userEvent.type(screen.getByLabelText(/verification code/i), ' 123456 ')
    await userEvent.click(screen.getByRole('button', { name: /verify/i }))

    expect(onConfirm).toHaveBeenCalledWith('123456')
  })
})
