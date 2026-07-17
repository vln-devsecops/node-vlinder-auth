import { signSession } from '../session'

// Step 1 of the identifier-first flow: the user submits an identifier
// (username or email) and the backend decides how they authenticate.
//
// Federation resolution (redirecting to an external IdP) lands in a later
// increment; for now every identifier resolves to local password. The result
// carries a signed "identify session" that threads the identifier to the
// subsequent /auth/password call, so the client never re-sends it.

export const IDENTIFY_SESSION_TTL_SECONDS = 300

export interface IdentifyParams {
  identifier: string
  signingKey: string
  now?: number
}

export interface IdentifyResult {
  method: 'password'
  identifySession: string
}

export function identify({ identifier, signingKey, now }: IdentifyParams): IdentifyResult {
  const trimmed = identifier.trim()
  if (!trimmed) {
    throw new InvalidIdentifierError('An identifier is required.')
  }

  // No federation yet -> always local password.
  const method = 'password' as const
  const identifySession = signSession(
    { identifier: trimmed, method },
    signingKey,
    IDENTIFY_SESSION_TTL_SECONDS,
    now,
  )
  return { method, identifySession }
}

export class InvalidIdentifierError extends Error {}
