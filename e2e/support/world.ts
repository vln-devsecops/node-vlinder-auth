import { setWorldConstructor, World, type IWorldOptions } from '@cucumber/cucumber'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminConfirmSignUpCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'

export interface Env {
  baseUrl: string
  userPoolId: string
  region: string
  /** Optional: only required by scenarios that seed a role directly (admin-panel.feature). */
  roleAssignmentsTableName: string | undefined
  defaultTenantId: string
}

// Deliberately does not throw here: the World is constructed for every
// scenario even during `cucumber-js --dry-run` (which never runs hooks or
// step bodies, just checks steps resolve) -- eager validation here would
// break dry-run syntax checks in environments with no live deployment
// available. Real validation happens in assertEnv(), called from the
// Before hook, which dry-run never reaches.
function loadEnv(): Env {
  const baseUrl = process.env['E2E_BASE_URL']
  const userPoolId = process.env['E2E_USER_POOL_ID']
  const region = process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION']

  return {
    baseUrl: baseUrl ?? '',
    userPoolId: userPoolId ?? '',
    region: region ?? '',
    roleAssignmentsTableName: process.env['E2E_ROLE_ASSIGNMENTS_TABLE'],
    defaultTenantId: process.env['E2E_DEFAULT_TENANT_ID'] ?? 'default',
  }
}

/** A test user created via admin-create-user, tracked for cleanup after the scenario. */
export interface TestUser {
  email: string
  password: string
  userId: string
}

export class AuthWorld extends World {
  env: Env
  browser!: Browser
  context!: BrowserContext
  page!: Page

  // Lazy: the AWS SDK clients validate `region` eagerly in their
  // constructors (even an empty string throws), and the World is
  // constructed for every scenario during `cucumber-js --dry-run`, which
  // never executes step bodies. Constructing these on first real use avoids
  // breaking dry-run in environments with no env vars set. See assertEnv().
  private _cognito: CognitoIdentityProviderClient | undefined
  private _ddb: DynamoDBDocumentClient | undefined

  private get cognito(): CognitoIdentityProviderClient {
    this._cognito ??= new CognitoIdentityProviderClient({ region: this.env.region })
    return this._cognito
  }

  private get ddb(): DynamoDBDocumentClient {
    this._ddb ??= DynamoDBDocumentClient.from(new DynamoDBClient({ region: this.env.region }))
    return this._ddb
  }

  /** Users created during the scenario, deleted in the After hook regardless of outcome. */
  private createdUsers: string[] = []

  lastError: string | undefined
  /** The primary (usually signed-in) test user for the current scenario. */
  testUser: TestUser | undefined
  /** admin-panel.feature: a second user the signed-in admin manages. */
  managedUser: TestUser | undefined

  constructor(options: IWorldOptions) {
    super(options)
    this.env = loadEnv()
  }

  /** Validates required env vars are set. Call from Before, not the constructor -- see loadEnv(). */
  assertEnv(): void {
    const missing = [
      ['E2E_BASE_URL', this.env.baseUrl],
      ['E2E_USER_POOL_ID', this.env.userPoolId],
      ['AWS_REGION or AWS_DEFAULT_REGION', this.env.region],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name)

    if (missing.length > 0) {
      throw new Error(`Missing required e2e environment variable(s): ${missing.join(', ')}`)
    }
  }

  async launchBrowser(): Promise<void> {
    this.browser = await chromium.launch()
    this.context = await this.browser.newContext({ baseURL: this.env.baseUrl })
    this.page = await this.context.newPage()
  }

  async closeBrowser(): Promise<void> {
    await this.page?.close()
    await this.context?.close()
    await this.browser?.close()
  }

  /**
   * Creates a Cognito user with a permanent password, bypassing the invite
   * email — for scenarios that need a known-good, already-confirmed account
   * (sign-in, admin-panel) rather than exercising the signup flow itself.
   */
  async createConfirmedTestUser(emailPrefix: string, password: string): Promise<TestUser> {
    const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`

    const created = await this.cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: this.env.userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
        MessageAction: 'SUPPRESS',
      }),
    )
    await this.cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: this.env.userPoolId,
        Username: email,
        Password: password,
        Permanent: true,
      }),
    )
    this.createdUsers.push(email)

    const userId = created.User?.Attributes?.find((a) => a.Name === 'sub')?.Value
    if (!userId) {
      throw new Error(`admin-create-user response for ${email} had no sub attribute`)
    }
    return { email, password, userId }
  }

  /**
   * Writes a role assignment directly into DynamoDB rather than through the
   * admin API -- test setup (arrange phase) is allowed to reach past the app
   * layer; the point of this suite is to exercise the *app* end to end, not
   * to solve the bootstrap problem of "how does the first admin get made"
   * (that's a real product question, deliberately out of scope here). Real
   * app code should never write to this table directly -- only the
   * post-confirmation trigger and the admin API do that.
   */
  async seedRoleAssignment(
    userId: string,
    roleId: string,
    activation: 'default' | 'elevated' = 'default',
  ): Promise<void> {
    if (!this.env.roleAssignmentsTableName) {
      throw new Error(
        'E2E_ROLE_ASSIGNMENTS_TABLE is not set; scenarios needing admin privileges require it',
      )
    }
    const tenantId = this.env.defaultTenantId
    await this.ddb.send(
      new PutCommand({
        TableName: this.env.roleAssignmentsTableName,
        // One row per (user, tenant, role); range key is the tenantId#roleId
        // composite. Seed roles default to `default` (active at login) so a
        // seeded admin actually carries admin privileges in their token.
        Item: { userId, tenantRole: `${tenantId}#${roleId}`, tenantId, roleId, activation },
      }),
    )
  }

  /**
   * Server-side confirmation for a user who signed up through the real SPA
   * form (see signup.feature) — Cognito never exposes verification codes via
   * API, so admin-confirm-sign-up is the only way to complete that flow
   * without an email-receiving service. Still exercises the real SignUpForm
   * and the real post-confirmation Lambda trigger.
   */
  async confirmSignUp(email: string): Promise<void> {
    await this.cognito.send(
      new AdminConfirmSignUpCommand({ UserPoolId: this.env.userPoolId, Username: email }),
    )
    if (!this.createdUsers.includes(email)) {
      this.createdUsers.push(email)
    }
  }

  async getUserStatus(email: string): Promise<string | undefined> {
    const result = await this.cognito.send(
      new AdminGetUserCommand({ UserPoolId: this.env.userPoolId, Username: email }),
    )
    return result.UserStatus
  }

  async getUserEnabledState(email: string): Promise<boolean | undefined> {
    const result = await this.cognito.send(
      new AdminGetUserCommand({ UserPoolId: this.env.userPoolId, Username: email }),
    )
    return result.Enabled
  }

  async getUserId(email: string): Promise<string> {
    const result = await this.cognito.send(
      new AdminGetUserCommand({ UserPoolId: this.env.userPoolId, Username: email }),
    )
    const userId = result.UserAttributes?.find((a) => a.Name === 'sub')?.Value
    if (!userId) {
      throw new Error(`No sub attribute found for ${email}`)
    }
    return userId
  }

  /**
   * Reads back all of a user's role assignments (written by the
   * post-confirmation trigger, seedRoleAssignment, or the admin API). A user
   * may hold several roles, so this returns the full set.
   */
  async getRoleAssignments(
    userId: string,
  ): Promise<Array<{ roleId: string; tenantId: string; activation: string }>> {
    if (!this.env.roleAssignmentsTableName) {
      throw new Error('E2E_ROLE_ASSIGNMENTS_TABLE is not set')
    }
    const result = await this.ddb.send(
      new QueryCommand({
        TableName: this.env.roleAssignmentsTableName,
        KeyConditionExpression: 'userId = :u',
        ExpressionAttributeValues: { ':u': userId },
      }),
    )
    return (result.Items ?? []).map((item) => ({
      roleId: item['roleId'] as string,
      tenantId: item['tenantId'] as string,
      activation: (item['activation'] as string) ?? 'default',
    }))
  }

  /** Registers a user created directly through the SPA (not via admin-create-user) for cleanup. */
  trackUserForCleanup(email: string): void {
    if (!this.createdUsers.includes(email)) {
      this.createdUsers.push(email)
    }
  }

  async cleanupUsers(): Promise<void> {
    // Best-effort throughout: the whole ephemeral environment gets torn
    // down shortly after anyway, but don't let cleanup failures fail the
    // scenario that already passed or failed on its own merits.
    await Promise.all(
      this.createdUsers.map(async (email) => {
        // Resolve the sub before deleting the Cognito user -- the role
        // assignment is keyed by it, and it's unresolvable afterwards.
        // Deleting the assignment is not just tidiness: listUsers hydrates
        // every assignment against Cognito, and rows left behind by earlier
        // scenarios poison every later scenario's admin-panel listing.
        const userId = await this.getUserId(email).catch(() => null)

        await this.cognito
          .send(new AdminDeleteUserCommand({ UserPoolId: this.env.userPoolId, Username: email }))
          .catch(() => {})

        if (userId && this.env.roleAssignmentsTableName) {
          await this.ddb
            .send(
              new DeleteCommand({
                TableName: this.env.roleAssignmentsTableName,
                Key: { userId, tenantId: this.env.defaultTenantId },
              }),
            )
            .catch(() => {})
        }
      }),
    )
    this.createdUsers = []
  }
}

setWorldConstructor(AuthWorld)
