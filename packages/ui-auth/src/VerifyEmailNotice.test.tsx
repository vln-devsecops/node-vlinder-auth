import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { VerifyEmailNotice } from './VerifyEmailNotice'

describe('VerifyEmailNotice', () => {
  it('shows the address the verification email was sent to', () => {
    render(<VerifyEmailNotice email="jane@example.com" onResend={vi.fn()} />)
    expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument()
  })

  it('calls onResend and shows a confirmation when the resend button is clicked', async () => {
    const onResend = vi.fn()
    render(<VerifyEmailNotice email="jane@example.com" onResend={onResend} />)

    await userEvent.click(screen.getByRole('button', { name: /resend/i }))

    expect(onResend).toHaveBeenCalled()
    expect(await screen.findByText(/resent/i)).toBeInTheDocument()
  })
})
