import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SignInFlow } from './SignInFlow'

describe('SignInFlow', () => {
  it('collects the identifier, then reveals the password step for a local account', async () => {
    const onIdentify = vi.fn().mockResolvedValue({ method: 'password' })
    const onPassword = vi.fn()
    render(<SignInFlow onIdentify={onIdentify} onPassword={onPassword} />)

    // Step 1: no password field yet.
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/email or username/i), 'jane@example.com')
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(onIdentify).toHaveBeenCalledWith('jane@example.com')

    // Step 2: password field appears, identifier is carried over.
    const passwordField = await screen.findByLabelText(/password/i)
    await userEvent.type(passwordField, 'secret123')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(onPassword).toHaveBeenCalledWith('jane@example.com', 'secret123')
  })

  it('redirects a federated identifier instead of prompting for a password', async () => {
    const onIdentify = vi
      .fn()
      .mockResolvedValue({ method: 'redirect', location: '/api/v1/auth/federation/start' })
    const onRedirect = vi.fn()
    render(<SignInFlow onIdentify={onIdentify} onPassword={vi.fn()} onRedirect={onRedirect} />)

    await userEvent.type(screen.getByLabelText(/email or username/i), 'bob@corp.example')
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(onRedirect).toHaveBeenCalledWith('/api/v1/auth/federation/start')
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('surfaces an identify error and stays on the identifier step', async () => {
    const onIdentify = vi.fn().mockRejectedValue(new Error('Service unavailable'))
    const onError = vi.fn()
    render(<SignInFlow onIdentify={onIdentify} onPassword={vi.fn()} onError={onError} />)

    await userEvent.type(screen.getByLabelText(/email or username/i), 'jane@example.com')
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(onError).toHaveBeenCalledWith('Service unavailable')
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('can go back to change the identifier', async () => {
    const onIdentify = vi.fn().mockResolvedValue({ method: 'password' })
    render(<SignInFlow onIdentify={onIdentify} onPassword={vi.fn()} />)

    await userEvent.type(screen.getByLabelText(/email or username/i), 'jane@example.com')
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    await screen.findByLabelText(/password/i)

    await userEvent.click(screen.getByRole('button', { name: /use a different account/i }))
    expect(screen.getByLabelText(/email or username/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })
})
