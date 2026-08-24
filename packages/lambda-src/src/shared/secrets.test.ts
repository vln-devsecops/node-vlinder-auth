import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { getSecret } from './secrets'

const secretsManagerMock = mockClient(SecretsManagerClient)

beforeEach(() => {
  secretsManagerMock.reset()
})

describe('getSecret', () => {
  it('fetches the secret value via GetSecretValueCommand', async () => {
    secretsManagerMock.on(GetSecretValueCommand).resolves({ SecretString: 'shh' })

    const value = await getSecret('arn:aws:secretsmanager:us-east-1:123:secret:fetch-test')

    expect(value).toBe('shh')
    expect(secretsManagerMock.commandCalls(GetSecretValueCommand)[0].args[0].input).toMatchObject(
      { SecretId: 'arn:aws:secretsmanager:us-east-1:123:secret:fetch-test' },
    )
  })

  it('caches the value, so a second call for the same secretId skips the SDK', async () => {
    secretsManagerMock.on(GetSecretValueCommand).resolves({ SecretString: 'cached-value' })

    const first = await getSecret('cache-hit-test')
    const second = await getSecret('cache-hit-test')

    expect(first).toBe('cached-value')
    expect(second).toBe('cached-value')
    expect(secretsManagerMock.commandCalls(GetSecretValueCommand)).toHaveLength(1)
  })

  it('propagates an SDK error rather than caching it', async () => {
    secretsManagerMock.on(GetSecretValueCommand).rejects(new Error('access denied'))

    await expect(getSecret('error-test')).rejects.toThrow('access denied')
  })

  it('throws when the secret has no SecretString value', async () => {
    secretsManagerMock.on(GetSecretValueCommand).resolves({ SecretBinary: new Uint8Array() })

    await expect(getSecret('binary-only-test')).rejects.toThrow(/SecretString/)
  })
})
