import { describe, expect, it } from 'vitest'
import { isMultiTenant } from './authConfig'

describe('isMultiTenant', () => {
  it('returns true when passed true', () => {
    expect(isMultiTenant(true)).toBe(true)
  })

  it('returns false when passed false', () => {
    expect(isMultiTenant(false)).toBe(false)
  })
})
