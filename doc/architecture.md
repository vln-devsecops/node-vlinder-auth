# Architecture

A Cognito-backed signup/login component with RBAC and a bundled admin panel,
delivered as a self-provisioning Terraform module. A consumer supplies an app
name and two AWS identifiers (a Route 53 zone and an ACM certificate) and gets
a complete, working auth stack — no Lambda ARNs, DynamoDB tables, or IAM roles
to wire by hand.

Why it is shaped this way: [`rationale.md`](./rationale.md). What is built and
in what order: [`plan.md`](./plan.md). The auth surface itself — flows, API
contract, token model: [`vendor-neutral-auth.md`](./vendor-neutral-auth.md).

## Repositories

The system spans five repos in the `vln-devsecops` GitHub org:

| Repo | Role |
| --- | --- |
| `workspace-vlinder-auth` | Superproject tying the others together as submodules; holds cross-cutting feature specs (`features/`) and workspace-level issues. |
| `terraform-modules` | `modules/aws/vlinder_auth` — the self-provisioning module. All AWS infrastructure. |
| `node-vlinder-auth` | The application code the module deploys: Lambda handlers, the admin API, the auth-site SPA, the reference BFF, and a reusable React component library. This repo. |
| `node-vlinder-auth-branding` | Vlinder-specific `AuthProfile` branding, published privately. Consumed by an adopter alongside the public packages and injected via runtime config — never a dependency of the shared library. |
| `infra` | Org-level plumbing: the delegated test zone and the IAM role CI assumes to run the module's live suite. Not part of a consumer's deployment. |

`node-vlinder-auth` is the authoring project (TDD, real TypeScript) for code
that must ultimately run inside `vlinder_auth`. It is **not** vendored as
source into the module — see [Build and release](#build-and-release).

## Runtime topology

Everything a user or admin touches is served from **one CloudFront
distribution** at `auth.<zone>` (prefix configurable via `domain_prefix`).
There is no Cognito Hosted UI — the module owns its own login and admin
experience. The browser never talks to Cognito directly; a bundled **auth
Lambda** owns all Cognito interaction and exposes only a first-party API.

All API traffic is namespaced under `/api/v1`, and **that prefix is preserved
end to end** — the API Gateway routes include it. Nothing strips it in
transit, so a future `/api/v2` can be routed alongside rather than colliding
with a rewritten `/api/v1`. `/api/v1/auth*` is a higher-precedence behavior
than `/api/v1/*`, so auth requests never fall through to the admin API.

```text
                         auth.<zone>  (CloudFront: aws_cloudfront_distribution.auth_site)
                                 │
        ┌────────────────────────┼────────────────────────────────────┐
        │ default behavior       │ /api/v1/auth*            │ /api/v1/*
        │ (S3 origin, OAC)       │ (custom origin)          │ (custom origin)
        ▼                        ▼                          ▼
   S3: the SPA build       aws/http_api               aws/http_api
   - /            login    (public — this is how       (JWT authorizer →
   - /admin       panel     a token is obtained)        this pool)
        │                                                     │
   spa_viewer_request                                  admin_api_rewrite
   CF function                                         CF function
```

Two CloudFront Functions modify requests. Both are called out here because an
edge rewrite that nobody remembers is a debugging trap:

- **`spa_viewer_request`** (default behavior) rewrites extensionless paths to
  the right `index.html` (`/admin*` → `/admin/index.html`, everything else →
  `/index.html`) so client-side routing works. It does not touch API paths,
  and it must not touch `/.well-known/*` either — that path is extensionless
  by specification, so the SPA fallback would otherwise swallow the discovery
  document and serve `index.html` in its place, with a `200`.
- **`admin_api_rewrite`** (`/api/v1/*`) lifts the `vln_auth_session` cookie
  into an `Authorization: Bearer` header so the JWT authorizer sees ordinary
  bearer semantics, and strips any client-supplied `x-origin-verify` header.
  It does **not** rewrite the URI.

The `/api/v1/auth*` behavior needs no function: its routes are public and its
paths are passed through unmodified.

`/.well-known/openid-configuration` is served from the S3 origin, written by
Terraform at apply time the same way `config.json` is — its values (the
issuer, the JWKS URI, the first-party endpoint URLs) are all per-deployment
constants known at apply time. It is public, cacheable and CORS-open, and it
is the published contract for what issuer and keys a relying party should
trust; see [`vendor-neutral-auth.md`](./vendor-neutral-auth.md). It needs a
behavior or a `spa_viewer_request` exemption so the SPA fallback does not
capture it.

Responses on the default behavior carry `X-Frame-Options: DENY` and
`Content-Security-Policy: frame-ancestors 'none'` (a CloudFront
response-headers policy). We host our own login UI rather than a hosted one
precisely to control the experience, which makes closing off clickjacking
against it our responsibility.

The SPA's built assets **are** managed by Terraform, so `terraform apply`
alone yields a working site. The prebuilt bundle is published to GitHub
Packages as `@vln-devsecops/auth-site`, installed at apply time, given its
runtime `config.json` via a `local_file` resource, and `aws s3 sync`ed to the
bucket with a CloudFront invalidation. Version bumps flow through Dependabot
on the module's `site-build/package.json`. The `/api/v1` prefix and its
sub-paths are fixed infrastructure constants baked into the SPA, never config.

## Authentication model

Sign-in is identifier-first: the user enters an identifier, the backend
resolves how that identifier authenticates, and the flow branches to a local
password prompt or a redirect to an external identity provider. The auth
Lambda verifies passwords server-side via `ADMIN_USER_PASSWORD_AUTH` and is
the only component that speaks Cognito.

Consuming applications obtain tokens through an authorization-code handoff
with PKCE; their back-end exchanges the code and decides what reaches its own
front-end. Full flows, endpoints and token handling are specified in
[`vendor-neutral-auth.md`](./vendor-neutral-auth.md). In outline:

- The **ID token** carries the user's full set of available scopes and is
  readable by front-end JavaScript, because it is what tells the UI what to
  render and offer.
- The **access token** carries only the scopes active for the user's default
  roles. Whether it is exposed to front-end JavaScript or kept in a cookie is
  a per-adopter BFF configuration choice.
- The **refresh token** is JWE-wrapped by the auth service, opaque even to the
  BFF holding it, and never reaches browser JavaScript.

Email verification uses codes generated and stored by this system rather than
by Cognito. Because the code is ours, a verification link embedding it is
equally available; neither depends on a Cognito hosted domain.

The admin panel is the one consumer that is same-origin with `auth.<zone>`,
so it rides the AS session cookie directly instead of running its own BFF.

## RBAC and tenancy

Role and privilege are strictly separate. An application defines a **role
catalog** (`role → { privileges, tenant_scope }`); roles resolve to privileges
at token issuance and **the role name never appears in a token**. A token
states exactly what its bearer may do, and a resource server reads its scopes
rather than re-deriving anything.

Privileges are `verb:tenant-id:resource-glob`, for example
`refund:abc123:orders/**` or `admin:federation`. Globs are gitignore-style:
`*` matches within a path segment, `**` traverses segments. Where the tenant
is irrelevant, `verb:resource-glob`, `verb::resource-glob` and
`verb:*:resource-glob` are equivalent. A bare `verb` is invalid — a privilege
always names what it acts on. Scopes travel in tokens as a standard
space-separated OAuth `scope` claim.

Two distinct lookups drive tenancy and identity-provider resolution:

- The calling application's **`client_id` resolves the tenant.**
- Within that tenant, the user's **email domain resolves the identity
  provider** — a tenant's domain owner can pin their users to a corporate IdP.
  Where no provider is pinned, the tenant's defaults apply and local signup
  and any offered social providers are available.

Navigating to `auth.<zone>` without a `client_id` therefore identifies no
tenant and is only meaningful for surfaces belonging to the auth component
itself — the admin panel, and later a user profile — which live in the auth
application's own tenant.

Both tenancy modes assign every user a tenant. `tenancy_mode = single` (the
default) differs from `multi` only in that it exposes no tenant CRUD.

Backed by native DynamoDB tables, all CMK-encrypted:

- **roles** — the seeded role catalog.
- **tenants** — tenant records, plus the `client_id → tenant_id` client
  registry and the `(email_domain, tenant_id) → identity provider` mapping.
- **user_role_assignments** — `(userId, tenantId) → roleId`, each assignment
  either active at login or held for a step-up. Its own dedicated CMK.
- **identity_providers** — external IdP configuration; secrets in Secrets
  Manager, referenced by ARN.

## The Lambda tier

All handlers are consumed from the `@vln-devsecops/auth-lambda` package:

- **auth-api** — the whole `/api/v1/auth` surface, and the single place that
  knows about Cognito. It is also the OIDC *client* to each external identity
  provider, since Cognito-native federation is hosted-bound.
- **admin-api** — the handlers behind the admin HTTP API: list/get users,
  enable/disable users, assign/revoke roles, and terminate all of a user's
  sessions. Authorization is enforced per-handler from the caller's token
  scopes; listing hydrates each assignment against Cognito and skips any whose
  user no longer exists, so a stale assignment cannot fail a whole listing.
- **post-confirmation** — resolves the new user's tenant, writes their initial
  role assignment with a conditional put so a redelivered trigger cannot
  clobber a later admin change, and adds baseline Cognito groups. Reads
  `event.userPoolId` from the trigger event rather than an env var, since the
  pool's `lambda_config` already depends on this function's ARN.
- **pre-sign-up** — auto-confirms accounts so Cognito never sends its own
  verification email; the app's own code is what gates sign-in.
- **pre-token-generation** (V2) — resolves roles to privileges and writes the
  scope claims, the full set on the ID token and the active subset on the
  access token.

Each Lambda's IAM policy grants both the DynamoDB actions it needs **and**
`kms:Decrypt`/`GenerateDataKey`/`DescribeKey` on the table CMKs — DynamoDB
with a customer-managed key requires the *caller* to hold KMS permission, or
every real invocation fails with an access-denied error.

## Build and release

The Lambda source is a **versioned deliverable**, not vendored source:

```text
node-vlinder-auth/packages/lambda-src
   └─ esbuild → one self-contained CJS bundle per handler
   └─ published to GitHub Packages as @vln-devsecops/auth-lambda

terraform-modules/modules/aws/vlinder_auth/lambda-build/package.json
   └─ depends on @vln-devsecops/auth-lambda            (bumped by Dependabot)
   └─ at apply time: null_resource runs `npm install`,
      archive_file zips node_modules/.../dist per handler
```

Handlers are bundled to CommonJS: each becomes one self-contained file with
its `shared/` helpers and AWS SDK dependencies inlined, so the deployed zip
has no unresolved relative imports (a raw `tsc` ESM build fails on Lambda's
native loader). A `dist/package.json` marks the output as CommonJS.

Published packages ship dual ESM+CJS builds with an `exports` map.

The auth-site SPA is built and uploaded by the module at apply time; `ui-auth`
is a peer-dependency React library a consuming app imports into its own
frontend; the reference BFF is published for adopters to build on.

## Testing strategy

Three layers, each catching what the layer below structurally cannot:

- **Contract tests** (`modules/aws/vlinder_auth/tests/*.tftest.hcl`,
  `mock_provider`) — plan-time assertions on module wiring: resource shapes,
  IAM policy contents, RBAC seeding, conditional resources, and the response
  headers and route-method invariants that keep the edge safe. Fast, no AWS.
- **Node unit tests** (Vitest, TDD throughout) — handler, SPA and BFF logic.
- **Live integration suite** (`tests/aws/vlinder_auth/run.sh`, run in CI via
  `ct_terraform_integration.yml`) — a real, ephemeral `terraform apply`,
  followed by the **BDD e2e suite** (`node-vlinder-auth/e2e`, Cucumber +
  Playwright) driving real browser flows against the deployed site and
  asserting against real Cognito and DynamoDB state, then a full
  `terraform destroy`. This is the only layer that invokes the Lambdas and
  exercises a real sign-in; several classes of bug (KMS grants, the null
  pre-token event, hosted-domain mismatches) are invisible everywhere else.
