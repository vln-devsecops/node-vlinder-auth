# Architecture

A Cognito-backed signup/login component with RBAC and a bundled admin panel,
delivered as a self-provisioning Terraform module. A consumer supplies an app
name and two AWS identifiers (a Route 53 zone and an ACM certificate) and gets
a complete, working auth stack — no Lambda ARNs, DynamoDB tables, or IAM roles
to wire by hand.

## Repositories

The system spans three repos in the `vln-devsecops` GitHub org:

| Repo | Role |
| --- | --- |
| `terraform-modules` | `modules/aws/vlinder_auth` — the self-provisioning module. All AWS infrastructure. |
| `node-vlinder-auth` | The application code the module deploys: Lambda triggers, the admin API, the auth-site SPA, and a reusable React component library. This repo. |
| `infra` | Org-level plumbing: the delegated test zone, and the IAM role CI assumes to run the module's live test suite. Not part of a consumer's deployment. |

`node-vlinder-auth` is the authoring project (TDD, real TypeScript) for code
that must ultimately run inside `vlinder_auth`. It is **not** vendored as
source into the module — see [Build and release](#build-and-release).

## Runtime topology

Everything a user or admin touches is served from **one CloudFront
distribution** at `auth.<zone>` (prefix configurable via `domain_prefix`).
There is deliberately no Cognito Hosted UI — the module owns its own login and
admin experience. The SPA speaks only a **first-party API**; a bundled **auth
Lambda** owns all Cognito interaction, so the browser never talks to Cognito
directly.

All API traffic is namespaced under `/api/v1`. The auth API and the admin API
share that prefix; `/api/v1/auth*` is a higher-precedence behavior than
`/api/v1/*`, so auth requests never fall through to the admin API.

```text
                         auth.<zone>  (CloudFront: aws_cloudfront_distribution.auth_site)
                                 │
        ┌────────────────────────┼────────────────────────────────────┐
        │ default behavior       │ /api/v1/auth*            │ /api/v1/*
        │ (S3 origin, OAC)       │ (custom origin)          │ (custom origin)
        ▼                        ▼                          ▼
   S3: the SPA build       aws/http_api               aws/http_api
   - /            login    (public: the auth          (JWT authorizer →
   - /admin       panel     Lambda owns Cognito)       this pool)
                                                             │
   spa_viewer_request      auth_api_rewrite           admin_api_rewrite
   CF function:            CF function:                CF function:
   route extensionless     strip /api/v1              strip /api/v1
   paths to the right      prefix                     prefix
   index.html
```

- **Default behavior → S3 (Origin Access Control).** A single SPA build
  (`packages/auth-site`) serves both the public auth screens at `/` and the
  admin panel at `/admin`. A CloudFront Function (`spa_viewer_request`)
  rewrites extensionless paths to the correct `index.html` (`/admin*` →
  `/admin/index.html`, everything else → `/index.html`) so client-side routing
  works. TTL is normal for static assets.
- **`/api/v1/auth*` → auth API.** The first-party, **public** login +
  self-service backend: identifier-first `identify`/`password`, plus
  `signup`/`confirm`/`resend`/`forgot`/`reset`. Built via the shared
  `aws/http_api` module (no JWT authorizer — this is how a token is obtained).
  The auth Lambda owns all Cognito interaction (`AdminInitiateAuth`, `SignUp`,
  `ConfirmSignUp`, `ForgotPassword`, …); the browser exchanges only plain
  first-party JSON. Same-origin, TTL 0, cookies forwarded (the in-flight
  identify session). A CloudFront Function strips the `/api/v1` prefix.
- **`/api/v1/*` → admin API.** The bundled admin HTTP API (built via the
  shared `aws/http_api` module, protected by a JWT authorizer pointed at this
  pool). Pure REST routes (`GET /users`, `PATCH /users/{userId}/enabled`,
  `PUT /users/{userId}/roles/{roleId}`, …). Same-origin, TTL 0. Only
  provisioned when `create_admin_panel = true` (the default). A CloudFront
  Function strips the `/api/v1` prefix.

The SPA's built assets are **not** managed by Terraform. `terraform apply`
creates the bucket and a placeholder `index.html`; a deploy step
(`packages/auth-site/scripts/deploy.sh`) builds the SPA, writes a runtime
`config.json` (the Cognito app-client id and a multi-tenant flag — the only
values that vary per deployment), and `aws s3 sync`s it to the bucket. The
`/api/v1` prefix and its sub-paths are fixed infrastructure constants baked
into the SPA, never config.

## Authentication model

The SPA speaks only the first-party `/api/v1/auth` API. Sign-in is
identifier-first (`identify` then `password`); the auth Lambda verifies the
password server-side via `ADMIN_USER_PASSWORD_AUTH` and returns tokens. The
`auth_site` app client has OAuth/hosted-UI flows disabled. Tokens are held in
`sessionStorage` (a transitional step) and shared between the `/` and `/admin`
pages; the admin page redirects to `/` if no valid session is present (it never
renders its own login form). Moving to httpOnly-cookie sessions — with an admin
API authorizer that reads the cookie instead of a Bearer header — is the next
planned step (see [`doc/vendor-neutral-auth.md`](./vendor-neutral-auth.md)).

Email verification uses **codes, not links** (`CONFIRM_WITH_CODE`). Link-based
verification points at a Cognito Hosted UI domain, which this design
deliberately does not create; a code has no such dependency and the auth site
provides a code-entry form.

## RBAC and tenancy

Role and privilege are kept strictly separate. An application defines a **role
catalog** (`role → { privileges, tenant_scope }`); only the resolved
**privileges** ever land in a token, never the role name. Downstream services
therefore only reason about privileges.

Privilege naming convention:

| Form | Meaning |
| --- | --- |
| `<family>:own` | Acts within the caller's own tenant. |
| `<family>:*` | Acts across all tenants (super-admin). |
| `<family>` | Ungated reference data, no tenant scoping. |

Effective access is the **intersection** of two inputs: the caller's role
privileges (the `permissions` claim) and *this token's* granted scopes (an
optional OAuth-style `scope` claim, same privilege shape). The narrower of the
two wins per family, so a token can be **downscoped** below its role but never
above it. A token with **no `scope` claim** is not downscoped — the role
governs (absence of a scope means full subject authority). No issuer emits a
`scope` claim today, so current behaviour is unchanged; the mechanism is in
place for the OAuth-style token model in
[`doc/vendor-neutral-auth.md`](./vendor-neutral-auth.md).

Backed by three native DynamoDB tables, all CMK-encrypted:

- **roles** — the seeded role catalog.
- **tenants** — tenant records (with an `emailDomain` index used to resolve a
  new user's tenant at signup).
- **user_role_assignments** — `(userId, tenantId) → roleId`. Its own dedicated
  CMK (it is the sensitive table); composed from the shared `aws/dynamodb`
  module.

`tenancy_mode` defaults to `single` (one implicit `default` tenant, no tenant
CRUD); `multi` enables real tenant records and tenant-scoped assignment.

## Lambda triggers and the admin API

Three Lambdas, all consumed from the `@vln-devsecops/auth-lambda` package (see
[Build and release](#build-and-release)):

- **post-confirmation** — fires when a new signup is confirmed. Resolves the
  user's tenant (by email domain in multi-tenant mode), writes their initial
  role assignment (conditional put, so a redelivered trigger never clobbers an
  admin's later change), and adds baseline Cognito groups. Reads
  `event.userPoolId` from the trigger event rather than an env var — the pool's
  `lambda_config` needs this function's ARN, so a `USER_POOL_ID` env var would
  be a circular dependency.
- **pre-token-generation** (V2) — resolves the caller's role → privileges and
  injects `permissions` (comma-joined) and `tenantId` as claims on both the ID
  and access tokens. Constructs the whole `claimsAndScopeOverrideDetails`
  object, which Cognito delivers as `null`.
- **admin-api** — the handlers behind the admin HTTP API: list/get users
  (scoped to the caller's `own` tenant or across all tenants for `*`), enable/
  disable users, assign/revoke roles. Authorization is enforced per-handler
  against the caller's privileges; listing hydrates each role assignment
  against Cognito and skips any whose user no longer exists (a stale assignment
  must not fail the whole listing).

Each Lambda's IAM policy grants both the DynamoDB actions it needs **and**
`kms:Decrypt`/`GenerateDataKey`/`DescribeKey` on the table CMKs — DynamoDB with
a customer-managed key requires the *caller* to hold KMS permission on the
key, or every real invocation fails with an access-denied error.

## Build and release

The Lambda source is a **versioned deliverable**, not vendored source:

```text
node-vlinder-auth/packages/lambda-src
   └─ esbuild → one self-contained CJS bundle per handler
   └─ published to GitHub Packages as @vln-devsecops/auth-lambda  (cd_publish_lambda_src.yml)

terraform-modules/modules/aws/vlinder_auth/lambda-build/package.json
   └─ depends on @vln-devsecops/auth-lambda            (bumped by Dependabot)
   └─ at apply time: null_resource runs `npm install`,
      archive_file zips node_modules/.../dist per handler
```

Handlers are bundled with esbuild to CommonJS: each handler becomes one
self-contained file with its `shared/` helpers and AWS SDK dependencies
inlined, so the deployed zip has no unresolved relative imports (a raw `tsc`
ESM build fails on Lambda's native loader). A `dist/package.json` marks the
output as CommonJS.

The auth-site SPA and the `ui-auth` component library are consumed differently:
the SPA is built and uploaded by a deploy pipeline (its bucket/URL are only
known after apply), and `ui-auth` is a peer-dependency React library a
consuming app can import into its *own* frontend.

## Testing strategy

Three layers, each catching what the layer below structurally cannot:

- **Contract tests** (`modules/aws/vlinder_auth/tests/*.tftest.hcl`,
  `mock_provider`) — plan-time assertions on module wiring: resource shapes,
  IAM policy contents, RBAC seeding, conditional resources. Fast, no AWS.
- **Node unit tests** (Vitest, TDD throughout) — the handler and SPA logic in
  `node-vlinder-auth`.
- **Live integration suite** (`tests/aws/vlinder_auth/run.sh`, run in CI via
  `ct_terraform_integration.yml`) — a real, ephemeral `terraform apply` into
  AWS, followed by the **BDD e2e suite** (`node-vlinder-auth/e2e`,
  Cucumber + Playwright) driving real browser flows against the deployed auth
  site, asserting against real Cognito and DynamoDB state, then a full
  `terraform destroy`. This is the only layer that actually invokes the
  Lambdas and exercises a real sign-in — several bugs (KMS grants, the
  null pre-token event, the verification-link/domain mismatch) were invisible
  to every other layer and only surfaced here.

## Notable design decisions

- **Own CloudFront + own UI instead of the Hosted UI.** Gives full control of
  branding and flow, a single first-party origin, and no hosted-redirect
  round trips. The cost is that the SPA speaks Cognito's IDP API directly and
  therefore knows it's talking to AWS — an open question is whether to hide
  that behind a thin auth Lambda later.
- **Role ≠ privilege, privileges-only in the token.** Lets an app restructure
  its role catalog without changing what downstream services check.
- **Lambda source as a published package, not vendored.** Keeps the module
  self-contained at apply time while the code stays properly TDD'd in a real
  project, with version bumps flowing through Dependabot.
- **Dedicated CMK for the role-assignments table.** It is the sensitive table;
  a compromise of a shared key shouldn't expose it.
