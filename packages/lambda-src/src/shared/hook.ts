type HookFn = (event: unknown, context: unknown) => unknown

/**
 * Invokes an optional, consumer-supplied extension point by dynamically
 * importing the module at `hookModulePath` (its default export, called with
 * the trigger event and a small context object). Lets app-specific side
 * effects plug in without forking the shared trigger. A hook that throws is
 * allowed to fail the trigger invocation rather than being silently
 * swallowed, since a signup that silently drops a required app-specific side
 * effect is worse than a visible failure.
 */
export async function invokeOptionalHook(
  hookModulePath: string | undefined,
  event: unknown,
  context: unknown,
): Promise<void> {
  if (!hookModulePath) {
    return
  }

  const hookModule = (await import(hookModulePath)) as { default?: HookFn }
  const hookFn = hookModule.default
  if (typeof hookFn === 'function') {
    await hookFn(event, context)
  }
}
