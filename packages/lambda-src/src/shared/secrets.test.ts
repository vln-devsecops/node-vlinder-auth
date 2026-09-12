import {
  GetSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { getSecret, getSecretVersion, getSecretVersions } from './secrets'

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

describe('getSecretVersion', () => {
  it('fetches the AWSCURRENT version, returning both the value and versionId', async () => {
    secretsManagerMock
      .on(GetSecretValueCommand, { VersionStage: 'AWSCURRENT' })
      .resolves({ SecretString: 'current-value', VersionId: 'version-current' })

    const result = await getSecretVersion('one-time-token-secret', 'AWSCURRENT')

    expect(result).toEqual({ value: 'current-value', versionId: 'version-current' })
    expect(secretsManagerMock.commandCalls(GetSecretValueCommand)[0].args[0].input).toMatchObject({
      SecretId: 'one-time-token-secret',
      VersionStage: 'AWSCURRENT',
    })
  })

  it('fetches the AWSPREVIOUS version, returning both the value and versionId', async () => {
    secretsManagerMock
      .on(GetSecretValueCommand, { VersionStage: 'AWSPREVIOUS' })
      .resolves({ SecretString: 'previous-value', VersionId: 'version-previous' })

    const result = await getSecretVersion('one-time-token-secret', 'AWSPREVIOUS')

    expect(result).toEqual({ value: 'previous-value', versionId: 'version-previous' })
  })

  it('throws when the version has no SecretString value', async () => {
    secretsManagerMock
      .on(GetSecretValueCommand, { VersionStage: 'AWSCURRENT' })
      .resolves({ VersionId: 'version-current', SecretBinary: new Uint8Array() })

    await expect(getSecretVersion('one-time-token-secret', 'AWSCURRENT')).rejects.toThrow(/SecretString/)
  })

  it('throws when the version has no VersionId', async () => {
    secretsManagerMock
      .on(GetSecretValueCommand, { VersionStage: 'AWSCURRENT' })
      .resolves({ SecretString: 'current-value' })

    await expect(getSecretVersion('one-time-token-secret', 'AWSCURRENT')).rejects.toThrow(/VersionId/)
  })

  it('returns undefined when the version stage does not exist yet (e.g. a never-rotated secret has no AWSPREVIOUS)', async () => {
    secretsManagerMock
      .on(GetSecretValueCommand, { VersionStage: 'AWSPREVIOUS' })
      .rejects(new ResourceNotFoundException({ message: 'not found', $metadata: {} }))

    const result = await getSecretVersion('one-time-token-secret', 'AWSPREVIOUS')

    expect(result).toBeUndefined()
  })

  it('propagates other SDK errors rather than swallowing them as undefined', async () => {
    secretsManagerMock
      .on(GetSecretValueCommand, { VersionStage: 'AWSPREVIOUS' })
      .rejects(new Error('access denied'))

    await expect(getSecretVersion('one-time-token-secret', 'AWSPREVIOUS')).rejects.toThrow('access denied')
  })

  it('is uncached: back-to-back calls for the same secretId/stage both hit the SDK', async () => {
    secretsManagerMock
      .on(GetSecretValueCommand, { VersionStage: 'AWSCURRENT' })
      .resolves({ SecretString: 'current-value', VersionId: 'version-current' })

    await getSecretVersion('one-time-token-secret', 'AWSCURRENT')
    await getSecretVersion('one-time-token-secret', 'AWSCURRENT')

    expect(secretsManagerMock.commandCalls(GetSecretValueCommand)).toHaveLength(2)
  })
})

describe('getSecretVersions', () => {
  it('returns current and previous, current first, when both exist', async () => {
    secretsManagerMock
      .on(GetSecretValueCommand, { VersionStage: 'AWSCURRENT' })
      .resolves({ SecretString: 'current-value', VersionId: 'version-current' })
    secretsManagerMock
      .on(GetSecretValueCommand, { VersionStage: 'AWSPREVIOUS' })
      .resolves({ SecretString: 'previous-value', VersionId: 'version-previous' })

    const versions = await getSecretVersions('one-time-token-secret')

    expect(versions).toEqual([
      { value: 'current-value', versionId: 'version-current' },
      { value: 'previous-value', versionId: 'version-previous' },
    ])
  })

  it('returns just current when the secret has never been rotated', async () => {
    secretsManagerMock
      .on(GetSecretValueCommand, { VersionStage: 'AWSCURRENT' })
      .resolves({ SecretString: 'current-value', VersionId: 'version-current' })
    secretsManagerMock
      .on(GetSecretValueCommand, { VersionStage: 'AWSPREVIOUS' })
      .rejects(new ResourceNotFoundException({ message: 'not found', $metadata: {} }))

    const versions = await getSecretVersions('one-time-token-secret')

    expect(versions).toEqual([{ value: 'current-value', versionId: 'version-current' }])
  })

  it('throws when the secret has no AWSCURRENT at all', async () => {
    secretsManagerMock
      .on(GetSecretValueCommand, { VersionStage: 'AWSCURRENT' })
      .rejects(new ResourceNotFoundException({ message: 'not found', $metadata: {} }))

    await expect(getSecretVersions('never-created-secret')).rejects.toThrow(/AWSCURRENT/)
  })
})
