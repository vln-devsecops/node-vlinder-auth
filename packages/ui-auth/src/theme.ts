export interface VlinderAuthTheme {
  primaryColor: string
  backgroundColor: string
  logoUrl: string
  fontFamily: string
}

/**
 * Ships as the default so branding works out of the box; every field is
 * independently overridable. `logoUrl` is a placeholder path -- point it at
 * the real hosted Vlinder logo asset when one is available.
 */
export const defaultVlinderTheme: VlinderAuthTheme = {
  primaryColor: '#1b3a5c',
  backgroundColor: '#ffffff',
  logoUrl: '/assets/vlinder-logo.svg',
  fontFamily: "'Inter', sans-serif",
}

export function resolveTheme(override: Partial<VlinderAuthTheme> = {}): VlinderAuthTheme {
  return { ...defaultVlinderTheme, ...override }
}
