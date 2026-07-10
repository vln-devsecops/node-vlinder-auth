import { describe, expect, it } from 'vitest'
import { defaultVlinderTheme, resolveTheme } from './theme'

describe('resolveTheme', () => {
  it('returns the default Vlinder theme when no override is given', () => {
    expect(resolveTheme()).toEqual(defaultVlinderTheme)
  })

  it('lets a consuming app override individual theme fields without losing the rest', () => {
    const theme = resolveTheme({ primaryColor: '#123456' })

    expect(theme.primaryColor).toBe('#123456')
    expect(theme.logoUrl).toBe(defaultVlinderTheme.logoUrl)
    expect(theme.fontFamily).toBe(defaultVlinderTheme.fontFamily)
  })

  it('lets a consuming app override every field', () => {
    const fullyCustom = {
      primaryColor: '#000000',
      backgroundColor: '#ffffff',
      logoUrl: 'https://example.com/logo.svg',
      fontFamily: 'Comic Sans MS',
    }

    expect(resolveTheme(fullyCustom)).toEqual(fullyCustom)
  })
})
