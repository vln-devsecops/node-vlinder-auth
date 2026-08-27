import type { AuthProfile, BuiltinProfileName } from '@vln-devsecops/auth-ui'

export interface SiteConfig {
  userPoolClientId: string
  multiTenant: boolean
  adminEnabled: boolean
  profile: BuiltinProfileName | AuthProfile
}

/** A deployment's `profile` field is opaque, adopter-owned data (a builtin
 *  name or a full custom AuthProfile) -- this site never validates its
 *  internal shape, the same passthrough trust `resolveProfile` itself
 *  extends. Only guards against the field being missing or clearly the
 *  wrong JSON type, falling back to AuthChrome's own generic default. */
function readProfile(data: Record<string, unknown>): BuiltinProfileName | AuthProfile {
  const profile = data['profile']
  if (typeof profile === 'string' || (typeof profile === 'object' && profile !== null)) {
    return profile as BuiltinProfileName | AuthProfile
  }
  return 'default'
}

/** Fetch /config.json at page load — this is where per-deployment Terraform
 *  outputs land (the vlinder_auth module writes config.json into the S3 origin
 *  itself, via a local_file resource, at apply time). Falls back gracefully so
 *  local dev with a missing config.json shows a clear error rather than
 *  crashing. */
export async function loadConfig(): Promise<SiteConfig> {
  const response = await fetch('/config.json')
  if (!response.ok) {
    throw new Error(`Failed to load /config.json: ${response.status}`)
  }
  const data = (await response.json()) as Record<string, unknown>
  return {
    userPoolClientId: data['userPoolClientId'] as string,
    multiTenant: Boolean(data['multiTenant']),
    // Missing field (older config.json) defaults to true, matching this
    // module's pre-profile behavior of always bundling the admin API.
    adminEnabled: data['adminEnabled'] === undefined ? true : Boolean(data['adminEnabled']),
    profile: readProfile(data),
  }
}
