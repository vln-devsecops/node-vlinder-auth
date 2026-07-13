import type { CognitoTokens } from './authConfig'

const SESSION_KEY = 'auth_tokens'

export function saveTokens(tokens: CognitoTokens): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(tokens))
}

export function loadTokens(): CognitoTokens | null {
  const raw = sessionStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as CognitoTokens
  } catch {
    return null
  }
}

export function clearTokens(): void {
  sessionStorage.removeItem(SESSION_KEY)
}

export function isTokenExpired(tokens: CognitoTokens): boolean {
  return Date.now() >= tokens.expiresAt
}
