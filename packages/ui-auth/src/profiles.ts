export interface AuthProfile {
  name: string
  primaryColor: string
  primaryHoverColor: string
  pageBackground: string
  cardBackground: string
  borderColor: string
  textPrimary: string
  textSecondary: string
  panelTextColor: string
  fontFamily: string
  radius: string
  companyName: string
  tagline: string
  logo: { kind: 'image'; src: string } | { kind: 'circle' }
}

/**
 * Un-branded fallback profile: same layout, neutral green palette, circle
 * placeholder logo. The only builtin profile -- vendor-specific branding
 * (e.g. Vlinder Software's own profile) lives in a separate private repo,
 * not here, and is passed in as a custom AuthProfile object rather than a
 * builtin name.
 */
export const defaultProfile: AuthProfile = {
  name: 'default',
  primaryColor: 'oklch(52% 0.14 148)',
  primaryHoverColor: 'oklch(44% 0.14 148)',
  pageBackground: '#f7faf8',
  cardBackground: '#ffffff',
  borderColor: '#dbe6df',
  textPrimary: '#1c2620',
  textSecondary: '#5b6b60',
  panelTextColor: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  radius: '16px',
  companyName: 'Your Company Name',
  tagline: 'Your Tagline Here',
  logo: { kind: 'circle' },
}

export const builtinProfiles = { default: defaultProfile } as const
export type BuiltinProfileName = keyof typeof builtinProfiles

export function resolveProfile(profile: BuiltinProfileName | AuthProfile): AuthProfile {
  return typeof profile === 'string' ? builtinProfiles[profile] : profile
}
