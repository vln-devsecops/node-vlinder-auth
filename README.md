# node-vlinder-auth

Vlinder-branded signup/login UI, plus the vendored source for the Lambda
triggers and admin panel consumed by
[`terraform-modules//modules/aws/cognito_auth`](https://github.com/vln-devsecops/terraform-modules/tree/main/modules/aws/cognito_auth).

## Why this repo exists

`cognito_auth` is a self-provisioning Terraform module: a consumer supplies an
app id and a couple of AWS identifiers (Route 53 zone, ACM certificate) and
gets a working Cognito-backed signup/login flow, RBAC, and a hosted admin
panel back — no Lambda ARNs or DynamoDB tables to wire by hand. Terraform
can't provision one thing, though: a component embedded in *another*
application's own frontend build. That piece — the branded signup/login UI —
lives here as a real, TDD'd package (`packages/ui-auth`).

The rest of this repo (`packages/lambda-src`, `packages/admin-panel-site`) is
the authoring project for code that gets **vendored into `terraform-modules`**
by this repo's CI, so the module stays self-contained at `terraform apply`
time while the code itself is still properly TDD'd in a real TypeScript
project.

## Layout

| Path | Purpose |
| --- | --- |
| `packages/ui-auth` | React components/hooks a consuming app's own frontend imports: sign-up, sign-in, verify-email, forgot-password. Themeable, Vlinder branding by default. |
| `packages/lambda-src` | Post-confirmation and pre-token-generation Cognito triggers, and the admin-api Lambda handlers. Vendored into `cognito_auth`'s `lambda-src/`. |
| `packages/admin-panel-site` | The small static admin panel bundled by `cognito_auth`. Vendored into the module's `admin-panel-site/`. |
| `e2e` | Cucumber + Playwright BDD suite exercising the whole stack (this repo's packages, deployed via a `cognito_auth` example) end to end. |
| `doc` | Architecture notes and the (unexecuted) doxchange migration plan. |

## RBAC model

Role and privilege are kept separate: an app defines a role catalog
(`role -> { privileges, tenant_scope }`), and only the resolved **privileges**
land in the issued JWT — never the role name. A role's `tenant_scope` is
either `"tenant"` (ordinary tenant-scoped roles, including a tenant admin) or
`"global"` (cross-tenant super-admin); both are the same mechanism with a
different scope. Single-tenant is the default mode: exactly one implicit
tenant, no tenant table, no tenant switcher.

The JWT itself only carries two custom claims: `permissions` (a comma-joined
privilege list) and `tenantId`. There is no separate "scope" claim — scope is
encoded directly in each privilege string. The bundled `admin-api`
(`packages/lambda-src/src/admin-api`) commits to a concrete convention for
its own privileges, documented here since it's the one piece of this repo
that actually enforces it (downstream consumers of `cognito_auth` are free to
invent their own privilege vocabulary for their own APIs):

```text
<privilege-family>:own   e.g. admin:users:read:own   -- same tenant as the caller only
<privilege-family>:*     e.g. admin:users:read:*      -- every tenant (super-admin)
<privilege-name>         e.g. admin:roles:read         -- ungated by tenant (reference data)
```

`assertTenantAccess` (`admin-api/authz.ts`) is the defense-in-depth check
every handler runs independently of the JWT authorizer: it re-derives the
caller's privileges from the claims and rejects any request whose privilege
scope doesn't cover the target tenant, rather than trusting that the
authorizer's mere presence was enough.

## Development

```bash
source ./bootstrap   # or: pwsh -File ./Bootstrap.ps1 on Windows
npm test
```
