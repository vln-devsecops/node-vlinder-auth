import type { Request, RequestHandler, Response } from 'express'
import * as authServiceClient from '../authServiceClient'
import { UpstreamContractError } from '../authServiceClient'
import type { BffConfig } from '../config'
import { clearBffCookie, LOGIN_NONCE_COOKIE, parseCookieHeader, sessionCookies } from '../cookies'
import { constantTimeEquals } from '../csrf'
import { verifyState } from '../stateJwe'

function queryParam(req: Request, key: string): string | undefined {
  const value = req.query[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * GET /login/callback -- the RP handoff's landing point (see
 * doc/vendor-neutral-auth.md's Login sequence diagram). Decrypts `state` to
 * recover the PKCE code_verifier, checks it was issued to *this* browser
 * (the LOGIN_NONCE_COOKIE check below -- see routes/login.ts and RFC 6749
 * §10.12; without it, an attacker could complete a login as themselves and
 * lure a victim into visiting the resulting callback URL, logging the victim
 * into the attacker's account), exchanges the one-time `token`
 * server-to-server, and mints the refresh-token, CSRF and (by default)
 * access-token cookies.
 */
export function callbackRoute(config: BffConfig): RequestHandler {
  return async (req: Request, res: Response) => {
    const token = queryParam(req, 'token')
    const state = queryParam(req, 'state')

    if (!token || !state) {
      res.status(400).json({ error: 'invalid_request', message: 'Missing token or state.' })
      return
    }

    const statePayload = await verifyState(state, config.stateJweKey)
    if (!statePayload) {
      res.status(400).json({ error: 'invalid_state', message: 'state is missing, invalid, tampered with, or expired.' })
      return
    }

    // Cleared as soon as it's read (below, merged into whichever Set-Cookie
    // header this request ends up sending) so a compliant browser won't
    // resend it on a second visit to the same callback URL (e.g. the
    // back button) -- best-effort tidiness, not a substitute for the
    // one-time token's own short TTL, which is what actually bounds replay.
    const loginNonceCookie = parseCookieHeader(req.headers.cookie)[LOGIN_NONCE_COOKIE]
    const clearLoginNonceCookie = clearBffCookie(LOGIN_NONCE_COOKIE)
    if (!loginNonceCookie || !constantTimeEquals(loginNonceCookie, statePayload.csrfNonce)) {
      res.setHeader('Set-Cookie', clearLoginNonceCookie)
      res.status(400).json({
        error: 'login_csrf',
        message: 'This callback was not issued to this browser, or the login has expired.',
      })
      return
    }

    const upstream = await authServiceClient.exchangeToken(config.authServiceBaseUrl, {
      token,
      code_verifier: statePayload.codeVerifier,
    })

    if (upstream.status < 200 || upstream.status >= 300) {
      res.status(upstream.status).json(upstream.body)
      return
    }

    let tokens
    try {
      tokens = authServiceClient.assertSessionTokens(upstream.body)
    } catch (error) {
      if (error instanceof UpstreamContractError) {
        res.status(502).json({ error: 'upstream_contract_violation', message: error.message })
        return
      }
      throw error
    }
    const { accessToken, idToken, refreshToken, expiresAt } = tokens

    res.setHeader('Set-Cookie', [
      clearLoginNonceCookie,
      ...sessionCookies(config, { accessToken, refreshToken, expiresAt }),
    ])

    res.status(200).json({
      idToken,
      expiresAt,
      ...(config.accessTokenDelivery === 'body' ? { accessToken } : {}),
    })
  }
}
