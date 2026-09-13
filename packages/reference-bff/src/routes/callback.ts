import type { Request, RequestHandler, Response } from 'express'
import * as authServiceClient from '../authServiceClient'
import { UpstreamContractError } from '../authServiceClient'
import type { BffConfig } from '../config'
import { sessionCookies } from '../cookies'
import { verifyState } from '../stateJwe'

function queryParam(req: Request, key: string): string | undefined {
  const value = req.query[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * GET /login/callback -- the RP handoff's landing point (see
 * doc/vendor-neutral-auth.md's Login sequence diagram). Decrypts `state` to
 * recover the PKCE code_verifier, exchanges the one-time `token`
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

    res.setHeader('Set-Cookie', sessionCookies(config, { accessToken, refreshToken, expiresAt }))

    res.status(200).json({
      idToken,
      expiresAt,
      ...(config.accessTokenDelivery === 'body' ? { accessToken } : {}),
    })
  }
}
