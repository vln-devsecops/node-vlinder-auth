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
        json: async () => ({ userPoolClientId: 'abc123', multiTenant: false, adminEnabled: true }),
      }),
    )

    const config = await loadConfig()

    expect(config).toEqual({ userPoolClientId: 'abc123', multiTenant: false, adminEnabled: true })
  })

  it('defaults adminEnabled to true when the field is absent (older config.json)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ userPoolClientId: 'abc123', multiTenant: false }),
      }),
    )

    expect((await loadConfig()).adminEnabled).toBe(true)
  })

  it('respects an explicit adminEnabled: false (auth_api profile)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ userPoolClientId: 'abc123', multiTenant: false, adminEnabled: false }),
      }),
    )

    expect((await loadConfig()).adminEnabled).toBe(false)
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
