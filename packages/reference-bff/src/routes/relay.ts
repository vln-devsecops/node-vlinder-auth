import type { Request, RequestHandler, Response } from 'express'
import * as authServiceClient from '../authServiceClient'
import type { BffConfig } from '../config'
import { ACCESS_COOKIE, clearSessionCookies, parseCookieHeader } from '../cookies'

export interface RelayRouteOptions {
  method: 'GET' | 'POST'
  /** Path on the auth service to relay to, e.g. "/api/v1/auth/whoami". */
  upstreamPath: string
  /**
   * /logout: after attempting the relay (regardless of whether it succeeds --
   * the auth service's own logout endpoint doesn't exist yet and will error,
   * which is fine per doc/rationale.md's "clearing the BFF's cookie only
   * discards its own copy") clear all three BFF cookies unconditionally.
   */
  clearCookiesOnComplete?: boolean
}

/**
 * Generic passthrough relay for /whoami, /sudo and /logout (none of these
 * exist yet on the auth service -- steps 9/10 of doc/plan.md -- so today
 * this simply forwards to a 404; that is expected).
 *
 * Attaches the access token as `Authorization: Bearer <token>`, read from
 * the vln_bff_access cookie if ACCESS_TOKEN_DELIVERY is 'cookie', or from
 * the incoming request's own Authorization header if it is 'body' (the
 * front-end holds the token itself in that mode and must send it).
 */
export function relayRoute(config: BffConfig, opts: RelayRouteOptions): RequestHandler {
  return async (req: Request, res: Response) => {
    const authorization = resolveAuthorization(config, req)

    const upstream = await authServiceClient.relay(config.authServiceBaseUrl, opts.upstreamPath, {
      method: opts.method,
      authorization,
      body: opts.method === 'POST' ? req.body : undefined,
    })

    if (opts.clearCookiesOnComplete) {
      res.setHeader('Set-Cookie', clearSessionCookies())
    }

    res.status(upstream.status).json(upstream.body)
  }
}

function resolveAuthorization(config: BffConfig, req: Request): string | undefined {
  if (config.accessTokenDelivery === 'cookie') {
    const cookies = parseCookieHeader(req.headers.cookie)
    const accessToken = cookies[ACCESS_COOKIE]
    return accessToken ? `Bearer ${accessToken}` : undefined
  }
  return req.header('authorization') ?? undefined
}
