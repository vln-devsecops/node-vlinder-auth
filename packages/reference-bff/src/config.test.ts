import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config'

const REQUIRED_ENV = {
  AUTH_SERVICE_BASE_URL: 'https://auth.example.com',
  RP_CLIENT_ID: 'client-1',
  RP_REDIRECT_URI: 'https://app.example.com/login/callback',
  STATE_JWE_KEY: 'a'.repeat(32),
  CSRF_SECRET: 'csrf-secret',
}

const ENV_KEYS = [...Object.keys(REQUIRED_ENV), 'ACCESS_TOKEN_DELIVERY', 'REFRESH_COOKIE_MAX_AGE_SECONDS', 'PORT']

describe('loadConfig', () => {
  const original: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original[key] = process.env[key]
      delete process.env[key]
    }
    Object.assign(process.env, REQUIRED_ENV)
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = original[key]
      }
    }
  })

  it('loads required values and applies defaults', () => {
    const config = loadConfig()
    expect(config.authServiceBaseUrl).toBe('https://auth.example.com')
    expect(config.rpClientId).toBe('client-1')
    expect(config.accessTokenDelivery).toBe('cookie')
    expect(config.refreshCookieMaxAgeSeconds).toBe(2592000)
    expect(config.port).toBe(3000)
  })

  it('strips a trailing slash from the auth service base URL', () => {
    process.env.AUTH_SERVICE_BASE_URL = 'https://auth.example.com/'
    expect(loadConfig().authServiceBaseUrl).toBe('https://auth.example.com')
  })

  it('throws loudly, naming the variable, when a required var is missing', () => {
    delete process.env.RP_CLIENT_ID
    expect(() => loadConfig()).toThrow(/RP_CLIENT_ID/)
  })

  it('respects ACCESS_TOKEN_DELIVERY=body', () => {
    process.env.ACCESS_TOKEN_DELIVERY = 'body'
    expect(loadConfig().accessTokenDelivery).toBe('body')
  })

  it('rejects an invalid ACCESS_TOKEN_DELIVERY value', () => {
    process.env.ACCESS_TOKEN_DELIVERY = 'nonsense'
    expect(() => loadConfig()).toThrow(/ACCESS_TOKEN_DELIVERY/)
  })

  it('respects a custom REFRESH_COOKIE_MAX_AGE_SECONDS', () => {
    process.env.REFRESH_COOKIE_MAX_AGE_SECONDS = '60'
    expect(loadConfig().refreshCookieMaxAgeSeconds).toBe(60)
  })
})
