// Provides the split brand-panel/card layout around any auth-ui form. The
// adopter supplies a profile (built-in name or a custom AuthProfile) and
// AuthChrome derives both the layout styling and the `theme` prop the form
// itself needs for its button/link color and font.

import { type ReactNode, useId } from 'react'
import { type AuthProfile, type BuiltinProfileName, resolveProfile } from './profiles'
import { type VlinderAuthTheme } from './theme'

export interface AuthChromeProps {
  profile?: BuiltinProfileName | AuthProfile
  /** The auth-ui form (SignInFlow, SignUpForm, etc). */
  children: ReactNode
  /** Optional supporting links/buttons below the form (e.g. "Create account"). */
  footer?: ReactNode
  /** Inline error/notice banner content, rendered above the form. */
  banner?: ReactNode
}

/** Derive the theme object the auth-ui form components expect from a profile. */
export function themeFromProfile(profile: AuthProfile): Partial<VlinderAuthTheme> {
  return {
    primaryColor: profile.primaryColor,
    backgroundColor: profile.cardBackground,
    fontFamily: profile.fontFamily,
    ...(profile.logo.kind === 'image' ? { logoUrl: profile.logo.src } : {}),
  }
}

export function AuthChrome(props: Readonly<AuthChromeProps>) {
  const profile = resolveProfile(props.profile ?? 'default')
  const scope = `auth-chrome-${useId().replace(/:/g, '')}`

  return (
    <div
      className={scope}
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        boxSizing: 'border-box',
        background: profile.pageBackground,
        fontFamily: profile.fontFamily,
      }}
    >
      <style>{`
        .${scope} .auth-chrome-card { display: flex; width: 100%; max-width: 960px;
          border-radius: ${profile.radius}; overflow: hidden; border: 1px solid ${profile.borderColor};
          background: ${profile.cardBackground}; box-shadow: 0 20px 40px -10px rgb(0 0 0 / 0.12); }
        .${scope} .auth-chrome-panel { width: 380px; flex-shrink: 0; background: ${profile.primaryColor};
          color: ${profile.panelTextColor}; display: flex; flex-direction: column; justify-content: space-between;
          padding: 56px; box-sizing: border-box; }
        .${scope} .auth-chrome-form { flex: 1; display: flex; align-items: center; justify-content: center;
          padding: 64px; box-sizing: border-box; min-width: 0; }
        .${scope} .auth-chrome-form form { display: flex; flex-direction: column; gap: 20px; width: 100%; max-width: 360px; }
        .${scope} .auth-chrome-form label { font-size: 13px; font-weight: 600; color: ${profile.textPrimary}; display: block; margin-bottom: 6px; }
        .${scope} .auth-chrome-form input { width: 100%; height: 44px; padding: 0 14px; box-sizing: border-box;
          border: 1px solid ${profile.borderColor}; border-radius: 10px; font-size: 14px; color: ${profile.textPrimary};
          background: ${profile.cardBackground}; }
        .${scope} .auth-chrome-form input:focus { outline: 2px solid ${profile.primaryColor}; outline-offset: 1px; }
        .${scope} .auth-chrome-form button[type="submit"] { height: 48px; border: none; border-radius: 10px;
          font-size: 15px; font-weight: 600; cursor: pointer; background: ${profile.primaryColor}; color: ${profile.panelTextColor}; }
        .${scope} .auth-chrome-form button[type="submit"]:hover { background: ${profile.primaryHoverColor}; }
        .${scope} .auth-chrome-form button[type="button"] { background: none; border: none; color: ${profile.primaryColor};
          font-size: 14px; cursor: pointer; padding: 0; text-align: left; }
        .${scope} .auth-chrome-form p[role="alert"] { color: #b42318; font-size: 13px; margin: 0; }
        .${scope} .auth-chrome-form p[role="status"] { color: ${profile.textSecondary}; font-size: 13px; margin: 0; }
        @media (max-width: 720px) {
          .${scope} .auth-chrome-card { flex-direction: column; max-width: 420px; }
          .${scope} .auth-chrome-panel { width: 100%; flex-direction: row; align-items: center; gap: 12px; padding: 20px 28px; }
        }
      `}</style>

      <div className="auth-chrome-card">
        <div className="auth-chrome-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {profile.logo.kind === 'circle' ? (
              <div style={{ height: 34, width: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', flexShrink: 0 }} />
            ) : (
              <img src={profile.logo.src} alt="" style={{ height: 34, width: 34 }} />
            )}
            <span style={{ fontSize: 17, fontWeight: 600 }}>{profile.companyName}</span>
          </div>
          <p style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.25, margin: 0, maxWidth: 320 }}>{profile.tagline}</p>
        </div>
        <div className="auth-chrome-form">
          <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {props.banner}
            {props.children}
            {props.footer}
          </div>
        </div>
      </div>
    </div>
  )
}
