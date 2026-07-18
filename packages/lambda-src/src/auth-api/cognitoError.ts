// The self-service auth endpoints (signup / confirm / resend / forgot / reset)
// wrap Cognito's user-facing operations. Those raise client-fault exceptions
// for the ordinary failure cases -- a mismatched code, a weak password, an
// already-taken username, an expired code. Surface those to the caller as a
// 400 with the provider's message (parity with what the old /idp proxy showed);
// re-throw anything else (server faults, bugs) so it becomes a 500.

export class CognitoClientError extends Error {}

/**
 * Re-throw a caught error as a {@link CognitoClientError} when it is an AWS SDK
 * client-fault exception, otherwise re-throw it unchanged. Always throws.
 */
export function rethrowCognitoError(error: unknown): never {
  const fault = (error as { $fault?: string } | null)?.$fault
  if (fault === 'client' && error instanceof Error) {
    throw new CognitoClientError(error.message)
  }
  throw error
}
