import {
  GetRandomPasswordCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { handler } from './handler'

const secretsManagerMock = mockClient(SecretsManagerClient)

beforeEach(() => {
  secretsManagerMock.reset()
})

describe('handler', () => {
  it('generates a random password and writes it to the target secret', async () => {
    secretsManagerMock.on(GetRandomPasswordCommand).resolves({ RandomPassword: 'generated-password-value' })
    secretsManagerMock.on(PutSecretValueCommand).resolves({})

    await handler({ secretId: 'one-time-token-secret', passwordLength: 32 })

    expect(secretsManagerMock.commandCalls(GetRandomPasswordCommand)[0].args[0].input).toEqual({
      ExcludePunctuation: true,
      PasswordLength: 32,
      RequireEachIncludedType: true,
    })
    expect(secretsManagerMock.commandCalls(PutSecretValueCommand)[0].args[0].input).toEqual({
      SecretId: 'one-time-token-secret',
      SecretString: 'generated-password-value',
    })
  })

  it('throws a clear error when GetRandomPassword returns no RandomPassword', async () => {
    secretsManagerMock.on(GetRandomPasswordCommand).resolves({})

    await expect(handler({ secretId: 'one-time-token-secret', passwordLength: 32 })).rejects.toThrow(
      /RandomPassword/,
    )
    expect(secretsManagerMock.commandCalls(PutSecretValueCommand)).toHaveLength(0)
  })

  it('propagates a PutSecretValue error rather than swallowing it', async () => {
    secretsManagerMock.on(GetRandomPasswordCommand).resolves({ RandomPassword: 'generated-password-value' })
    secretsManagerMock.on(PutSecretValueCommand).rejects(new Error('access denied'))

    await expect(handler({ secretId: 'one-time-token-secret', passwordLength: 32 })).rejects.toThrow(
      'access denied',
    )
  })
})
