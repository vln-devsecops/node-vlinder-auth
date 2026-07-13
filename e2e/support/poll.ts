/**
 * Cognito invokes the post-confirmation Lambda synchronously as part of the
 * confirm call, so this shouldn't normally need to retry -- the short poll
 * is a safety margin for DynamoDB read-after-write timing, not a workaround
 * for genuine async behavior.
 */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 10000,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T
  do {
    last = await fn()
    if (predicate(last)) {
      return last
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  } while (Date.now() < deadline)
  return last
}
