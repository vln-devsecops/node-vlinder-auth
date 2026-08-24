import { describe, expect, it } from 'vitest'
import { builtinProfiles, defaultProfile, resolveProfile, vlinderProfile } from './profiles'

describe('builtinProfiles', () => {
  it('has exactly the vlinder and default keys', () => {
    expect(Object.keys(builtinProfiles).sort()).toEqual(['default', 'vlinder'])
  })

  it('maps each key to its matching exported profile', () => {
    expect(builtinProfiles.vlinder).toBe(vlinderProfile)
    expect(builtinProfiles.default).toBe(defaultProfile)
  })
})

describe('resolveProfile', () => {
  it('resolves the "vlinder" builtin name', () => {
    expect(resolveProfile('vlinder')).toBe(vlinderProfile)
  })

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
