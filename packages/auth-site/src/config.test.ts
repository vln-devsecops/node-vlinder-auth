import { describe, it, expect, vi, afterEach } from 'vitest'
import { loadConfig } from './config'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('loadConfig', () => {
  it('parses a valid config.json response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ userPoolClientId: 'abc123', multiTenant: false }),
      }),
    )

    const config = await loadConfig()

    expect(config).toEqual({ userPoolClientId: 'abc123', multiTenant: false })
  })

  it('coerces truthy multiTenant to boolean true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ userPoolClientId: 'id', multiTenant: true }),
      }),
    )

    expect((await loadConfig()).multiTenant).toBe(true)
  })

  it('throws when the server returns a non-OK status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    )

    await expect(loadConfig()).rejects.toThrow('Failed to load /config.json: 404')
  })
})
