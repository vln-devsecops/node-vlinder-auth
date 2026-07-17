import { describe, expect, it } from 'vitest'
import { verifySession } from '../session'
import { identify, InvalidIdentifierError } from './identify'

const KEY = 'test-signing-key-000000000000000000000000'

describe('identify', () => {
  it('resolves to local password and issues an identify session carrying the identifier', () => {
    const result = identify({ identifier: 'jane@example.com', signingKey: KEY })
    expect(result.method).toBe('password')
    const payload = verifySession(result.identifySession, KEY)
    expect(payload).toMatchObject({ identifier: 'jane@example.com', method: 'password' })
  })

  it('trims surrounding whitespace from the identifier', () => {
    const result = identify({ identifier: '  jane@example.com  ', signingKey: KEY })
    expect(verifySession(result.identifySession, KEY)).toMatchObject({
      identifier: 'jane@example.com',
    })
  })

  it('rejects an empty identifier', () => {
    expect(() => identify({ identifier: '   ', signingKey: KEY })).toThrow(InvalidIdentifierError)
  })
})
