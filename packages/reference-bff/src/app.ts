import express, { type NextFunction, type Request, type Response, type Application } from 'express'
import type { BffConfig } from './config'
import { CSRF_COOKIE, parseCookieHeader, REFRESH_COOKIE } from './cookies'
import { verifyCsrfToken } from './csrf'
import { loginRoute } from './routes/login'
import { callbackRoute } from './routes/callback'
import { refreshRoute } from './routes/refresh'
import { relayRoute } from './routes/relay'

export const CSRF_HEADER = 'x-vln-csrf-token'

/**
 * Double-submit CSRF middleware for state-changing routes (POST /refresh,
 * /sudo, /logout -- never GET /login, /login/callback or /whoami; see
 * doc/vendor-neutral-auth.md and terraform-modules's admin-api-csrf.md).
 *
 * Reads the vln_bff_refresh cookie (the "session id" this BFF uses for the
 * HMAC -- see csrf.ts), the vln_auth_csrf cookie, and the X-Vln-Csrf-Token
 * header, and requires all three to agree. Missing refresh cookie, missing
 * CSRF cookie, missing header, or any mismatch is 403 (not 401): the request
 * itself is malformed/forged, which is a distinct failure mode from "you're
 * unauthenticated" -- matching the admin API's own edge implementation.
 */
function csrfMiddleware(config: BffConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const cookies = parseCookieHeader(req.headers.cookie)
    const sessionId = cookies[REFRESH_COOKIE]
    if (!sessionId) {
      res.status(403).json({ error: 'csrf_validation_failed' })
      return
    }
    const headerValue = req.header(CSRF_HEADER)
    const ok = verifyCsrfToken(config.csrfSecret, sessionId, cookies[CSRF_COOKIE], headerValue)
    if (!ok) {
      res.status(403).json({ error: 'csrf_validation_failed' })
      return
    }
    next()
  }
}

/**
 * Assembles the reference BFF's Express application. Exported both for
 * testing (supertest) and for adopters who want to mount individual route
 * factories into their own existing Express app instead of running this as
 * a standalone process (see server.ts for the turnkey entrypoint).
 */
export function createApp(config: BffConfig): Application {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json())

  app.get('/login', loginRoute(config))
  app.get('/login/callback', callbackRoute(config))
  app.post('/refresh', csrfMiddleware(config), refreshRoute(config))

  app.get('/whoami', relayRoute(config, { method: 'GET', upstreamPath: '/api/v1/auth/whoami' }))
  app.post(
    '/sudo',
    csrfMiddleware(config),
    relayRoute(config, { method: 'POST', upstreamPath: '/api/v1/auth/sudo' }),
  )
  app.post(
    '/logout',
    csrfMiddleware(config),
    relayRoute(config, { method: 'POST', upstreamPath: '/api/v1/auth/logout', clearCookiesOnComplete: true }),
  )

  return app
}
