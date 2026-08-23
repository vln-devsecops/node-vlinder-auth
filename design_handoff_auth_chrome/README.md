# Handoff: Auth Chrome for node-vlinder-auth

## Overview
`packages/auth-site` (in `vln-devsecops/node-vlinder-auth`) mounts `@vln-devsecops/auth-ui`'s
form components (`SignInFlow`, `SignUpForm`, `ForgotPasswordForm`, `ConfirmSignUpForm`,
`VerifyEmailNotice`) with zero styling — raw labels/inputs/buttons, no layout. This handoff
adds a **profile-driven chrome layer**: a split brand-panel/card layout wrapping any of
those forms, themeable per adopter via an `AuthProfile` object, with two profiles baked in
(`vlinder` = real branding, `default` = neutral fallback).

## About the design files
`reference/Auth Workflow.dc.html` and `reference/AuthBrandPanel.dc.html` are **HTML design
references** — interactive mockups built to show the intended look, not code to import
directly into the repo. `AuthChrome.tsx` and `profiles.ts` in this folder ARE the intended
implementation, already written as real TSX against the actual `@vln-devsecops/auth-ui`
API (read from the repo) — copy those into the codebase as-is, then wire per the steps
below. Open the `.dc.html` files in a browser to see the design (they're self-contained).

## Fidelity
**High-fidelity.** Colors, spacing, radius, and copy in `profiles.ts` are exact values,
matched against `node-vlinder-auth`'s actual form components and the Vlinder Software
design system tokens (indigo `oklch(52% 0.17 266)` primary, `stone` neutrals, 16px card
radius, General Sans font).

## Task
1. Copy `AuthChrome.tsx` and `profiles.ts` into `packages/ui-auth/src/`.
2. Export them from `packages/ui-auth/src/index.ts`:
   ```ts
   export { AuthChrome, themeFromProfile } from './AuthChrome'
   export { vlinderProfile, defaultProfile, resolveProfile } from './profiles'
   export type { AuthProfile, BuiltinProfileName } from './profiles'
   ```
3. Rewrite `packages/auth-site/src/main.tsx` to wrap each page's form in `<AuthChrome>`
   instead of rendering it bare. Pick a profile (`vlinderProfile` by default) and pass
   `themeFromProfile(profile)` as the form's `theme` prop:
   ```tsx
   import { AuthChrome, themeFromProfile, vlinderProfile } from '@vln-devsecops/auth-ui'

   const profile = vlinderProfile
   const theme = themeFromProfile(profile)

   {page === 'signin' && (
     <AuthChrome
       profile={profile}
       banner={error && <p role="alert">{error}</p>}
       footer={
         <>
           <button type="button" onClick={() => { setError(null); setPage('signup') }}>Create account</button>
           <button type="button" onClick={() => { setError(null); setPage('forgot') }}>Forgot password?</button>
         </>
       }
     >
       <SignInFlow onIdentify={handleIdentify} onPassword={handlePassword} onError={setError} theme={theme} />
     </AuthChrome>
   )}
   ```
   Repeat for the `signup`, `forgot`, and `verify` pages — same pattern, swap the child form
   and footer buttons. Full current `main.tsx` is in the repo at that path if you need the
   exact existing handlers (`handleIdentify`, `handlePassword`, etc.) — they don't change,
   only the JSX wrapping does.
4. Host the real Vlinder logo at `/assets/vlinder-logo-transparent.svg` (referenced by
   `vlinderProfile.logo.src`) — currently `theme.ts`'s `defaultVlinderTheme.logoUrl` points
   at `/assets/vlinder-logo.svg`, which doesn't exist in the repo yet either.
5. Open a PR with these changes. Suggested branch: `feat/auth-chrome-profiles`. Suggested
   PR description: "Adds a themeable AuthChrome layout wrapping the existing unstyled
   auth-ui forms, with a vendored `vlinder` branding profile and a neutral `default`
   fallback profile for other adopters."

## Screens / views
Both profiles render the same layout; only colors/logo/copy change.

- **Sign in** (`SignInFlow`): two-step identifier → password. Split card: 380px brand
  panel (left) + form (right), 64px padding, 24px gap between fields, "Remember me" +
  "Forgot password?" row, primary button, divider ("or"), secondary Google button, footer
  link to sign up.
- **Sign up** (`SignUpForm`): full name, work email, password (with a caption below: "Use
  8+ characters with a mix of letters, numbers and symbols."), terms-agreement checkbox,
  primary button, Google button, footer link to log in.
- **Forgot password** (`ForgotPasswordForm`, step 1 `request`): email field, "Send reset
  link" button, "Back to log in" link with a left-arrow icon.
- **Reset password** (`ForgotPasswordForm`, step 2 `confirm`): new password + confirm
  password fields, "Reset password" button.
- **Verify email** (`ConfirmSignUpForm` + `VerifyEmailNotice`): centered layout, 6 separate
  1-digit code inputs (`48px` square, monospace, centered text), "Verify" button, "Resend"
  link.

All screens: card `border-radius: 16px`, `border: 1px solid` profile border color,
`box-shadow: 0 20px 40px -10px rgb(0 0 0 / 0.12)`. Below 720px viewport width the brand
panel collapses to a horizontal bar above the form (logo + name only, tagline hidden) and
the card goes full-width (max 420px).

## Design tokens

**vlinder profile**
- primaryColor: `oklch(52% 0.17 266)` — primaryHover: `oklch(44% 0.16 266)`
- pageBackground: `oklch(98% 0.004 70)` — cardBackground: `#ffffff`
- borderColor: `oklch(90% 0.008 70)`
- textPrimary: `oklch(18% 0.008 70)` — textSecondary: `oklch(45% 0.012 70)`
- font: `'General Sans', sans-serif`
- radius: `16px`
- companyName: "Vlinder Software" — tagline: "Security built into every layer of your IIoT stack."
- logo: image, `/assets/vlinder-logo-transparent.svg`

**default profile**
- primaryColor: `oklch(52% 0.14 148)` (green) — primaryHover: `oklch(44% 0.14 148)`
- pageBackground: `#f7faf8` — cardBackground: `#ffffff`
- borderColor: `#dbe6df`
- textPrimary: `#1c2620` — textSecondary: `#5b6b60`
- font: `system-ui, sans-serif`
- radius: `16px`
- companyName: "Your Company Name" — tagline: "Your Tagline Here"
- logo: plain circle (`rgba(255,255,255,0.9)`), no image

Field height: 44px inputs, 48px submit button. Form max-width: 360px. Code-input gap: 10px
desktop / 8px mobile.

## Assets
- Vlinder logo: needs to be added to the repo at `/assets/vlinder-logo-transparent.svg`
  (not currently present — see step 4 above).
- No other imagery. No icons required beyond a plain left-arrow glyph on "Back to log in"
  and a Google "G" mark on the secondary sign-in button (any icon set already in the repo,
  or omit if none is available).

## Files in this bundle
- `AuthChrome.tsx` — the chrome component (real TSX, copy as-is into `packages/ui-auth/src/`)
- `profiles.ts` — `AuthProfile` type + `vlinderProfile`/`defaultProfile` (copy as-is into `packages/ui-auth/src/`)
- `reference/Auth Workflow.dc.html` — full visual reference (desktop + mobile, all 5 screens, both profiles via a "profile" toggle, error-state examples)
- `reference/AuthBrandPanel.dc.html` — the brand-panel sub-piece in isolation
