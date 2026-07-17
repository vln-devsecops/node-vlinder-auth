import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { getCognitoClient } from '../shared/cognito-client'
import { identify, InvalidIdentifierError } from './handlers/identify'
import { AuthFailedError, InvalidSessionError, password } from './handlers/password'
import {
  IDENTIFY_SESSION_COOKIE,
  AS_SESSION_COOKIE,
  parseCookies,
  serializeSessionCookie,
} from './session'
import { IDENTIFY_SESSION_TTL_SECONDS } from './handlers/identify'
import { AS_SESSION_TTL_SECONDS } from './handlers/password'

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function json(
  statusCode: number,
  body?: unknown,
  cookies?: string[],
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...(cookies ? { cookies } : {}),
  }
}

/**
 * Public auth API for the vendor-neutral login flow (no JWT authorizer -- this
 * is how a token is obtained in the first place). Routes on routeKey. The SPA
 * talks to these same-origin; the identify/AS sessions travel as HttpOnly
 * cookies so no token material reaches browser JS.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const signingKey = requireEnv('SESSION_SIGNING_KEY')
  const body = event.body ? (JSON.parse(event.body) as Record<string, unknown>) : {}

  try {
    switch (event.routeKey) {
      case 'POST /auth/identify': {
        const result = await identify({ identifier: String(body.identifier ?? ''), signingKey })
        return json(
          200,
          { method: result.method },
          [
            serializeSessionCookie(IDENTIFY_SESSION_COOKIE, result.identifySession, {
              maxAgeSeconds: IDENTIFY_SESSION_TTL_SECONDS,
            }),
          ],
        )
      }

      case 'POST /auth/password': {
        const cookies = parseCookies(event.cookies)
        const result = await password({
          identifySession: cookies[IDENTIFY_SESSION_COOKIE],
          password: String(body.password ?? ''),
          cognitoClient: getCognitoClient(),
          clientId: requireEnv('AUTH_CLIENT_ID'),
          userPoolId: requireEnv('USER_POOL_ID'),
          signingKey,
        })

        if (result.status === 'challenge') {
          return json(200, {
            challenge: result.challengeName,
            challengeSession: result.challengeSession,
          })
        }
        return json(200, {}, [
          serializeSessionCookie(AS_SESSION_COOKIE, result.asSession, {
            maxAgeSeconds: AS_SESSION_TTL_SECONDS,
          }),
        ])
      }

      default:
        return json(404, { error: `Unrecognized route: ${event.routeKey}` })
    }
  } catch (error) {
    if (error instanceof InvalidIdentifierError) {
      return json(400, { error: error.message })
    }
    if (error instanceof InvalidSessionError) {
      return json(401, { error: error.message })
    }
    if (error instanceof AuthFailedError) {
      return json(401, { error: error.message })
    }
    throw error
  }
}
