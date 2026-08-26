import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthChrome, themeFromProfile } from './AuthChrome'
import { type AuthProfile, defaultProfile } from './profiles'

const customImageProfile: AuthProfile = {
  ...defaultProfile,
  name: 'custom',
  companyName: 'Acme Corp',
  tagline: 'Acme does it all.',
  logo: { kind: 'image', src: '/assets/acme-logo.svg' },
}

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

  it('uses the default profile when none is given: its company name, tagline, and a circle placeholder (no img)', () => {
    render(
      <AuthChrome>
        <div />
      </AuthChrome>,
    )

    expect(screen.getByText(defaultProfile.companyName)).toBeInTheDocument()
    expect(screen.getByText(defaultProfile.tagline)).toBeInTheDocument()
    expect(screen.queryByAltText('')).not.toBeInTheDocument()
  })

  it('"default" resolves to the same builtin profile as omitting profile entirely', () => {
    render(
      <AuthChrome profile="default">
        <div />
      </AuthChrome>,
    )

    expect(screen.getByText(defaultProfile.companyName)).toBeInTheDocument()
    expect(screen.getByText(defaultProfile.tagline)).toBeInTheDocument()
  })

  it('respects a custom inline AuthProfile, including an image-kind logo', () => {
    render(
      <AuthChrome profile={customImageProfile}>
        <div />
      </AuthChrome>,
    )

    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    expect(screen.getByText('Acme does it all.')).toBeInTheDocument()
    // alt="" is deliberate (the company name is already announced by the
    // adjacent text span), so the logo is queried by its alt attribute
    // rather than getByRole('img') -- an empty alt makes the image
    // presentational, which getByRole correctly excludes by default.
    expect(screen.getByAltText('')).toHaveAttribute('src', '/assets/acme-logo.svg')
  })
})

describe('themeFromProfile', () => {
  it('includes logoUrl for an image-kind logo', () => {
    expect(themeFromProfile(customImageProfile)).toEqual({
      primaryColor: customImageProfile.primaryColor,
      backgroundColor: customImageProfile.cardBackground,
      fontFamily: customImageProfile.fontFamily,
      logoUrl: '/assets/acme-logo.svg',
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
