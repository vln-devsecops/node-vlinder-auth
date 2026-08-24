import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthChrome, themeFromProfile } from './AuthChrome'
import { defaultProfile, vlinderProfile } from './profiles'

describe('AuthChrome', () => {
  it('renders banner, children, and footer', () => {
    render(
      <AuthChrome
        banner={<p role="alert">Something went wrong</p>}
        footer={<button type="button">Create account</button>}
      >
        <div data-testid="form-slot">the form</div>
      </AuthChrome>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.getByTestId('form-slot')).toHaveTextContent('the form')
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
  })

  it('defaults to the vlinder profile: company name, tagline, and an image logo', () => {
    render(
      <AuthChrome>
        <div />
      </AuthChrome>,
    )

    expect(screen.getByText('Vlinder Software')).toBeInTheDocument()
    expect(
      screen.getByText('Security built into every layer of your IIoT stack.'),
    ).toBeInTheDocument()
    // alt="" is deliberate (the company name is already announced by the
    // adjacent text span), so the logo is queried by its alt attribute
    // rather than getByRole('img') -- an empty alt makes the image
    // presentational, which getByRole correctly excludes by default.
    expect(screen.getByAltText('')).toHaveAttribute(
      'src',
      vlinderProfile.logo.kind === 'image' ? vlinderProfile.logo.src : '',
    )
  })

  it('the default profile shows its own company name, tagline, and a circle placeholder (no img)', () => {
    render(
      <AuthChrome profile="default">
        <div />
      </AuthChrome>,
    )

    expect(screen.getByText('Your Company Name')).toBeInTheDocument()
    expect(screen.getByText('Your Tagline Here')).toBeInTheDocument()
    expect(screen.queryByAltText('')).not.toBeInTheDocument()
  })

  it('respects a custom inline AuthProfile', () => {
    render(
      <AuthChrome
        profile={{
          ...defaultProfile,
          companyName: 'Acme Corp',
          tagline: 'Acme does it all.',
        }}
      >
        <div />
      </AuthChrome>,
    )

    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    expect(screen.getByText('Acme does it all.')).toBeInTheDocument()
  })
})

describe('themeFromProfile', () => {
  it('includes logoUrl for an image-kind logo', () => {
    expect(themeFromProfile(vlinderProfile)).toEqual({
      primaryColor: vlinderProfile.primaryColor,
      backgroundColor: vlinderProfile.cardBackground,
      fontFamily: vlinderProfile.fontFamily,
      logoUrl: vlinderProfile.logo.kind === 'image' ? vlinderProfile.logo.src : undefined,
    })
  })

  it('omits logoUrl for a circle-kind logo', () => {
    const theme = themeFromProfile(defaultProfile)

    expect(theme).not.toHaveProperty('logoUrl')
    expect(theme).toEqual({
      primaryColor: defaultProfile.primaryColor,
      backgroundColor: defaultProfile.cardBackground,
      fontFamily: defaultProfile.fontFamily,
    })
  })
})
