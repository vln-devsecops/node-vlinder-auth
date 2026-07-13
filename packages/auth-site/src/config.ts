export interface SiteConfig {
  userPoolClientId: string
  multiTenant: boolean
}

/** Fetch /config.json at page load — this is where Terraform outputs land
 *  at deploy time (written by deploy.sh). Falls back gracefully so local
 *  dev with a missing config.json shows a clear error rather than crashing. */
export async function loadConfig(): Promise<SiteConfig> {
  const response = await fetch('/config.json')
  if (!response.ok) {
    throw new Error(`Failed to load /config.json: ${response.status}`)
  }
  const data = (await response.json()) as Record<string, unknown>
  return {
    userPoolClientId: data['userPoolClientId'] as string,
    multiTenant: Boolean(data['multiTenant']),
  }
}
