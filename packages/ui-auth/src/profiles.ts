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

/** Vendored, baked-in profile matching the Vlinder Software design system. */
export const vlinderProfile: AuthProfile = {
  name: 'vlinder',
  primaryColor: 'oklch(52% 0.17 266)',
  primaryHoverColor: 'oklch(44% 0.16 266)',
  pageBackground: 'oklch(98% 0.004 70)',
  cardBackground: '#ffffff',
  borderColor: 'oklch(90% 0.008 70)',
  textPrimary: 'oklch(18% 0.008 70)',
  textSecondary: 'oklch(45% 0.012 70)',
  panelTextColor: '#ffffff',
  fontFamily: "'General Sans', sans-serif",
  radius: '16px',
  companyName: 'Vlinder Software',
  tagline: 'Security built into every layer of your IIoT stack.',
  logo: { kind: 'image', src: '/assets/vlinder-logo-transparent.svg' },
}

/** Un-branded fallback profile: same layout, neutral green palette, circle placeholder logo. */
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

export const builtinProfiles = { vlinder: vlinderProfile, default: defaultProfile } as const
export type BuiltinProfileName = keyof typeof builtinProfiles

export function resolveProfile(profile: BuiltinProfileName | AuthProfile): AuthProfile {
  return typeof profile === 'string' ? builtinProfiles[profile] : profile
}
