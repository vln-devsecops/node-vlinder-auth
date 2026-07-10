import { beforeEach, describe, expect, it } from 'vitest'
import { invokeOptionalHook } from './hook'
import * as recordingHook from './__fixtures__/recordingHook'

beforeEach(() => {
  recordingHook.calls.length = 0
})

describe('invokeOptionalHook', () => {
  it('does nothing when no hook module path is configured', async () => {
    await expect(invokeOptionalHook(undefined, { a: 1 }, { b: 2 })).resolves.toBeUndefined()
    expect(recordingHook.calls).toHaveLength(0)
  })

  it('imports and invokes the configured hook module with the event and context', async () => {
    await invokeOptionalHook('./__fixtures__/recordingHook', { a: 1 }, { b: 2 })

    expect(recordingHook.calls).toEqual([{ event: { a: 1 }, context: { b: 2 } }])
  })

  it('propagates an error thrown by the hook rather than swallowing it', async () => {
    await expect(
      invokeOptionalHook('./__fixtures__/throwingHook', {}, {}),
    ).rejects.toThrow('hook exploded')
  })
})
