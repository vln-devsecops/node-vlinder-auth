// The auth tokens now live in an HttpOnly cookie set by the backend (the auth
// Lambda's /auth/password sets it; the admin API's edge function copies it into
// an Authorization header). JavaScript cannot read them -- the XSS win. All the
// SPA keeps is a non-sensitive marker of when the session expires, used only to
// drive the admin page's redirect guard; the cookie is the real credential.

const SESSION_KEY = 'auth_session'

export interface SessionMarker {
  expiresAt: number
}

export function saveSession(marker: SessionMarker): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(marker))
}

export function loadSession(): SessionMarker | null {
  const raw = sessionStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SessionMarker
    return typeof parsed.expiresAt === 'number' ? parsed : null
  } catch {
    return null
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY)
}

export function isSessionExpired(marker: SessionMarker): boolean {
  return Date.now() >= marker.expiresAt
}
