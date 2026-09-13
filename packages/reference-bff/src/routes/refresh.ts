import type { Request, RequestHandler, Response } from 'express'
import * as authServiceClient from '../authServiceClient'
import type { BffConfig } from '../config'
import { clearSessionCookies, parseCookieHeader, REFRESH_COOKIE, sessionCookies } from '../cookies'

/**
 * POST /refresh -- reads the BFF's own refresh-token cookie, forwards it
 * opaquely to the auth service, and rotates all three cookies on success
 * (see doc/vendor-neutral-auth.md's Refresh section). A 401 from the auth
 * service (expired/revoked/reuse-detected) clears all three cookies and
 * propagates 401, so the front-end's single-flighted retry logic sees a
 * clean signal to redirect to /login again.
 *
 * Requires the CSRF check (applied by app.ts's csrfMiddleware before this
 * handler runs) since this is a state-changing request.
 */
export function refreshRoute(config: BffConfig): RequestHandler {
  return async (req: Request, res: Response) => {
    const cookies = parseCookieHeader(req.headers.cookie)
    const refreshToken = cookies[REFRESH_COOKIE]
    if (!refreshToken) {
      res.status(401).json({ error: 'no_refresh_token' })
      return
    }

    const upstream = await authServiceClient.refresh(config.authServiceBaseUrl, {
      refresh_token: refreshToken,
    })

    if (upstream.status === 401) {
      res.setHeader('Set-Cookie', clearSessionCookies())
      res.status(401).json(upstream.body)
      return
    }

    if (upstream.status < 200 || upstream.status >= 300) {
      res.status(upstream.status).json(upstream.body)
      return
    }

    const { accessToken, idToken, refreshToken: rotatedRefreshToken, expiresAt } = upstream.body

    res.setHeader(
      'Set-Cookie',
      sessionCookies(config, { accessToken, refreshToken: rotatedRefreshToken, expiresAt }),
    )

    res.status(200).json({
      idToken,
      expiresAt,
      ...(config.accessTokenDelivery === 'body' ? { accessToken } : {}),
    })
  }
}
