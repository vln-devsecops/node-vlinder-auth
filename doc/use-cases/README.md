# First-version use cases

Business-readable use cases for the **first version** of `vlinder_auth`,
written as Gherkin and grouped by the two personas the shipped product serves:
the **end user** and the **admin**. They are derived from the repo
documentation ([`../architecture.md`](../architecture.md),
[`../vendor-neutral-auth.md`](../vendor-neutral-auth.md)) and the behaviour of
the shipped packages (`ui-auth`, `auth-site`, `lambda-src`).

These files are **documentation**, not part of the executable e2e suite. They
describe *what the product does for a user*, in a vendor-neutral way (no
Cognito, no AWS, no HTTP shapes). The runnable BDD scenarios — with step
definitions, a real browser, and real Cognito/DynamoDB — live in
[`../../e2e/features`](../../e2e/features) and overlap these on purpose.

## Layout

| File | Persona | Use cases |
| --- | --- | --- |
| `end-user/sign-up.feature` | End user | Local email/password registration, code-based email verification, resend code, client-side validation |
| `end-user/sign-in.feature` | End user | Identifier-first sign-in, generic failure that doesn't enumerate accounts, switching account |
| `end-user/password-reset.feature` | End user | Code-based forgot/reset password |
| `end-user/session.feature` | End user | Redirect to sign-in for a protected page without a session; shared session across the site |
| `admin/user-management.feature` | Admin | List users (tenant-scoped), view a user, enable/disable, stale-assignment tolerance |
| `admin/role-management.feature` | Admin | List the role catalog, grant/revoke roles, elevated-by-default grant, idempotency |
| `admin/access-scope.feature` | Admin | `own` vs `*` tenant-scope enforcement, ungated reference data, missing-privilege refusal |

### Admin actions (v1)

The complete set of actions an admin can take in the first version, and the
privilege family each is gated on. Every use case above exercises one or more
of these, and `access-scope.feature` asserts the scope check on each:

| Action | Route | Privilege family |
| --- | --- | --- |
| List users in scope | `GET /users` | `admin:users:read` |
| View a single user | `GET /users/{userId}` | `admin:users:read` |
| Enable or disable a user | `PATCH /users/{userId}/enabled` | `admin:users:write` |
| Grant a role to a user | `PUT /users/{userId}/roles/{roleId}` | `admin:users:write` |
| Revoke a role from a user | `DELETE /users/{userId}/roles/{roleId}` | `admin:users:write` |
| List the role catalog | `GET /roles` | `admin:roles:read` (ungated by tenant) |

A grant carries an activation (`elevated` by default — held for a future sudo
step-up — or `default` for a login-active role); see `role-management.feature`.

## What "first version" means here

Scope follows the migration state recorded in
[`../vendor-neutral-auth.md`](../vendor-neutral-auth.md): the identifier-first
login and the self-service lifecycle (sign-up / confirm / resend / forgot /
reset) are shipped and the SPA speaks only the first-party `/api/v1/auth`
surface. Deliberately **out of scope** for these v1 use cases, because they are
later increments:

- Federated / "Continue with &lt;provider&gt;" login and signup.
- The relying-party BFF token handoff (`/authorize` + `/token`) and
  httpOnly-cookie sessions (v1 holds tokens in `sessionStorage`).
- The **sudo step-up** that activates an `elevated` role — in v1 a newly
  granted role is *recorded* as elevated but cannot yet be exercised.
- Admin-managed identity-provider configuration.

## Conventions

- One `Feature` per file, one persona per top-level folder.
- Scenarios are written from the user's point of view — no infrastructure
  vocabulary — so they stay valid if the engine behind the API is ever swapped.
