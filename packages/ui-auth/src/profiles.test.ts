import { describe, expect, it } from 'vitest'
import { builtinProfiles, defaultProfile, resolveProfile } from './profiles'

describe('builtinProfiles', () => {
  it('has exactly the default key', () => {
    expect(Object.keys(builtinProfiles)).toEqual(['default'])
  })

  it('maps "default" to the exported defaultProfile', () => {
    expect(builtinProfiles.default).toBe(defaultProfile)
  })
})

describe('resolveProfile', () => {
  it('resolves the "default" builtin name', () => {
    expect(resolveProfile('default')).toBe(defaultProfile)
  })

  it('passes through a custom inline AuthProfile object unchanged', () => {
    const custom = {
      name: 'custom',
      primaryColor: '#123456',
      primaryHoverColor: '#654321',
      pageBackground: '#fafafa',
      cardBackground: '#ffffff',
      borderColor: '#eeeeee',
      textPrimary: '#000000',
      textSecondary: '#333333',
      panelTextColor: '#ffffff',
      fontFamily: 'Comic Sans MS, sans-serif',
      radius: '4px',
      companyName: 'Acme Corp',
      tagline: 'Acme does it all.',
      logo: { kind: 'circle' as const },
    }

    expect(resolveProfile(custom)).toBe(custom)
  })
})
