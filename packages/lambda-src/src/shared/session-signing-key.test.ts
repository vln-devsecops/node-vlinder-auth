import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { mockClient } from 'aws-sdk-client-mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetSessionSigningKeyCacheForTests, getSessionSigningKey } from './session-signing-key'

const secretsManagerMock = mockClient(SecretsManagerClient)

beforeEach(() => {
  secretsManagerMock.reset()
  __resetSessionSigningKeyCacheForTests()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getSessionSigningKey', () => {
  it('fetches the secret from Secrets Manager', async () => {
    secretsManagerMock.on(GetSecretValueCommand).resolves({ SecretString: 'key-v1' })

    await expect(getSessionSigningKey('secret-id')).resolves.toBe('key-v1')
    expect(secretsManagerMock.commandCalls(GetSecretValueCommand)).toHaveLength(1)
  })

  it('reuses the cached value for calls within the TTL', async () => {
    secretsManagerMock.on(GetSecretValueCommand).resolves({ SecretString: 'key-v1' })

    await getSessionSigningKey('secret-id')
    vi.advanceTimersByTime(4 * 60 * 1000)
    await getSessionSigningKey('secret-id')

    expect(secretsManagerMock.commandCalls(GetSecretValueCommand)).toHaveLength(1)
  })

  it('refetches once the cache is older than the TTL, picking up a rotated value', async () => {
    secretsManagerMock.on(GetSecretValueCommand).resolves({ SecretString: 'key-v1' })
    await getSessionSigningKey('secret-id')

    vi.advanceTimersByTime(6 * 60 * 1000)
    secretsManagerMock.on(GetSecretValueCommand).resolves({ SecretString: 'key-v2' })

    await expect(getSessionSigningKey('secret-id')).resolves.toBe('key-v2')
    expect(secretsManagerMock.commandCalls(GetSecretValueCommand)).toHaveLength(2)
  })

  it('does not cache a failed fetch, so the next call retries', async () => {
    secretsManagerMock
      .on(GetSecretValueCommand)
      .rejectsOnce(new Error('throttled'))
      .resolves({ SecretString: 'key-v1' })

    await expect(getSessionSigningKey('secret-id')).rejects.toThrow('throttled')
    await expect(getSessionSigningKey('secret-id')).resolves.toBe('key-v1')
  })

  it('throws when the secret has no SecretString', async () => {
    secretsManagerMock.on(GetSecretValueCommand).resolves({})

    await expect(getSessionSigningKey('secret-id')).rejects.toThrow('has no SecretString')
  })
})
