import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { getCognitoClient } from '../shared/cognito-client'
import { getDdbDocClient } from '../shared/ddb-client'
import { getSecret } from '../shared/secrets'
import { getSesClient } from '../shared/ses-client'
import { identify, IDENTIFY_SESSION_TTL_SECONDS, InvalidIdentifierError } from './handlers/identify'
import { AuthFailedError, InvalidSessionError, password, UnverifiedAccountError } from './handlers/password'
import { confirmSignUp, resendConfirmation, signUp } from './handlers/registration'
import { confirmForgotPassword, forgotPassword } from './handlers/recovery'
import { CognitoClientError } from './cognitoError'
import { InvalidVerificationCodeError } from './verificationCodeError'
import {
  AS_SESSION_COOKIE,
  IDENTIFY_SESSION_COOKIE,
  parseCookies,
  serializeSessionCookie,
} from './session'

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

/** Reads a request-body field as a string, defaulting anything else (including absent) to ''. */
function bodyString(value: unknown): string {
  return typeof value === 'string' ? value : ''
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
 * talks to these same-origin; the in-flight identify session travels as an
 * HttpOnly cookie. Transitional: /auth/password returns the auth tokens in the
 * body for the SPA's current sessionStorage flow (see handlers/password.ts).
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const signingKey = await getSecret(requireEnv('SESSION_SIGNING_KEY_SECRET_ID'))
  const ddbDocClient = getDdbDocClient()
  const sesClient = getSesClient()
  const verificationCodesTableName = requireEnv('VERIFICATION_CODES_TABLE_NAME')
  const verificationCodeTtlSeconds = Number(requireEnv('VERIFICATION_CODE_TTL_SECONDS'))
  const verificationCodeMaxAttempts = Number(requireEnv('VERIFICATION_CODE_MAX_ATTEMPTS'))
  const fromAddress = requireEnv('SES_FROM_ADDRESS')
  const body = event.body ? (JSON.parse(event.body) as Record<string, unknown>) : {}

  try {
    switch (event.routeKey) {
      case 'POST /auth/identify': {
        const result = await identify({ identifier: bodyString(body.identifier), signingKey })
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
          password: bodyString(body.password),
          cognitoClient: getCognitoClient(),
          clientId: requireEnv('AUTH_CLIENT_ID'),
          userPoolId: requireEnv('USER_POOL_ID'),
          signingKey,
          ddbDocClient,
          verificationCodesTableName,
        })

        if (result.status === 'challenge') {
          return json(200, {
            challenge: result.challengeName,
            challengeSession: result.challengeSession,
          })
        }
        // Deliver the access token as an HttpOnly, same-origin session cookie
        // (Path=/ so it reaches /api/v1/*, where the admin API's edge function
        // turns it into an Authorization header). The SPA never sees the token;
        // it gets only the expiry, to drive its redirect guard.
        const maxAgeSeconds = Math.max(
          0,
          Math.floor((result.tokens.expiresAt - Date.now()) / 1000),
        )
        return json(200, { expiresAt: result.tokens.expiresAt }, [
          serializeSessionCookie(AS_SESSION_COOKIE, result.tokens.accessToken, {
            maxAgeSeconds,
            path: '/',
          }),
        ])
      }

      case 'POST /auth/signup': {
        const email = bodyString(body.email)
        await signUp({
          email,
          password: bodyString(body.password),
          givenName: bodyString(body.givenName),
          familyName: bodyString(body.familyName),
          cognitoClient: getCognitoClient(),
          clientId: requireEnv('AUTH_CLIENT_ID'),
        })
        // The account is auto-confirmed the instant SignUp completes (see
        // pre-sign-up/handler.ts) but still login-gated until this code is
        // verified -- send it now rather than waiting for an explicit resend.
        await resendConfirmation({
          email,
          ddbDocClient,
          tableName: verificationCodesTableName,
          ttlSeconds: verificationCodeTtlSeconds,
          sesClient,
          fromAddress,
        })
        return json(200, {})
      }

      case 'POST /auth/confirm': {
        await confirmSignUp({
          email: bodyString(body.email),
          code: bodyString(body.code),
          ddbDocClient,
          tableName: verificationCodesTableName,
          maxAttempts: verificationCodeMaxAttempts,
        })
        return json(200, {})
      }

      case 'POST /auth/resend': {
        await resendConfirmation({
          email: bodyString(body.email),
          ddbDocClient,
          tableName: verificationCodesTableName,
          ttlSeconds: verificationCodeTtlSeconds,
          sesClient,
          fromAddress,
        })
        return json(200, {})
      }

      case 'POST /auth/forgot': {
        await forgotPassword({
          email: bodyString(body.email),
          cognitoClient: getCognitoClient(),
          userPoolId: requireEnv('USER_POOL_ID'),
          ddbDocClient,
          tableName: verificationCodesTableName,
          ttlSeconds: verificationCodeTtlSeconds,
          sesClient,
          fromAddress,
        })
        return json(200, {})
      }

      case 'POST /auth/reset': {
        await confirmForgotPassword({
          email: bodyString(body.email),
          code: bodyString(body.code),
          newPassword: bodyString(body.newPassword),
          cognitoClient: getCognitoClient(),
          userPoolId: requireEnv('USER_POOL_ID'),
          ddbDocClient,
          tableName: verificationCodesTableName,
          maxAttempts: verificationCodeMaxAttempts,
        })
        return json(200, {})
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
    if (error instanceof UnverifiedAccountError) {
      return json(401, { error: error.message })
    }
    if (error instanceof InvalidVerificationCodeError) {
      return json(400, { error: error.message })
    }
    // Ordinary self-service failures (bad code, weak password, taken username)
    // surface as a 400 with the provider's message.
    if (error instanceof CognitoClientError) {
      return json(400, { error: error.message })
    }
    throw error
  }
}
