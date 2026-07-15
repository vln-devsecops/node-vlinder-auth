# Plan: vendor-neutral authentication

## Goal

The frontend must not know it is talking to Cognito. Today the auth-site SPA
constructs raw Cognito JSON-RPC calls (`X-Amz-Target: ...InitiateAuth`, the
`AWSCognitoIdentityProviderService` request/response shapes, `USER_PASSWORD_AUTH`
flow) and posts them at `/api/v1/idp`. That hard-couples the UI to Cognito and
blocks ever moving to (or federating with) another identity provider without a
frontend rewrite.

Replace the direct-to-Cognito proxy with a **first-party auth API** the SPA
talks to in vendor-neutral terms. Cognito becomes one implementation detail
behind that API, swappable later without touching the frontend.

## Target UX flow (identifier-first)

1. **User enters an identifier** (username or email) — pre-fillable from a
   remembered value in `localStorage`/cookie.
2. **Backend resolves the identity provider** tied to that account and tells
   the frontend how to proceed:
   - **Federated IdP** → the identify response tells the frontend to make a
     **top-level browser navigation** to a same-origin authorize endpoint
     (`/api/v1/auth/authorize`), which answers with a **real `302`** to the
     provider. The frontend does not know the vendor and never handles the
     cross-origin redirect itself — it just sets `window.location`.
   - **Local password** → the response tells the frontend to prompt for a
     password, which it submits back to the same API (a plain `fetch`, no
     navigation).
   - So: **`200`** carrying a next-step directive for both branches, and the
     federated branch's directive is "navigate to this same-origin URL," which
     is where the genuine **`302`** happens. See "Settled: redirect is a real
     302" below.

This is standard **home-realm discovery / identifier-first** login. Cognito
supports the pieces (hosted federation, `AdminInitiateAuth`, managed login),
but the point is the *frontend contract* is ours, not Cognito's.

## Proposed API contract (`/api/v1/auth`)

A new REST-ish surface under the existing `/api/v1` prefix, served by a new
**auth Lambda** (sibling to the admin-api Lambda, same `aws/http_api`
pattern — but on **public** routes, no JWT authorizer, since this is how you
get a token in the first place). Illustrative, to be firmed up:

- `POST /api/v1/auth/identify`
  Body: `{ "identifier": "jane@example.com" }`
  → `200 { "method": "password", "session": "<opaque>" }` — prompt for password.
  → `200 { "method": "redirect", "location": "/api/v1/auth/authorize?session=<opaque>" }`
    — the `location` is **same-origin**; the frontend does
    `window.location = location`.
- `GET /api/v1/auth/authorize?session=<opaque>`
  The genuine redirect. Looks up the resolved federated provider for the
  session and answers **`302`** with `Location:` set to the provider's
  `/authorize?...` (client_id, redirect_uri back to our callback, state, PKCE).
  Because this is a top-level browser navigation to a same-origin endpoint, the
  browser follows the cross-origin `302` natively — no `fetch`, no React
  redirect handling.
- `POST /api/v1/auth/password`
  Body: `{ "session": "<opaque>", "password": "..." }`
  → `200 { "tokens": { accessToken, idToken, refreshToken, expiresAt } }`
  → `200 { "challenge": "NEW_PASSWORD_REQUIRED", ... }` for MFA/new-password
    challenges (the backend owns challenge orchestration, not the SPA).
- `POST /api/v1/auth/callback` (or a GET redirect target)
  Completes a federated login: exchanges the provider's code for tokens,
  returns them in the same vendor-neutral `tokens` shape.
- `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout` — round out the
  lifecycle.
- Signup/verify/forgot-password move here too
  (`POST /api/v1/auth/signup`, `/confirm`, `/forgot`, `/reset`), so the SPA
  never speaks a Cognito verb anywhere.

Everything the SPA sends and receives is a plain first-party JSON shape. No
`X-Amz-Target`, no Cognito response envelopes, no Cognito flow names.

## What changes, by layer

**`node-vlinder-auth/packages/lambda-src`** — new `auth-api/` handler set
(identify / password / callback / refresh / logout / signup / confirm /
forgot / reset). It owns *all* Cognito interaction: `AdminInitiateAuth` /
`RespondToAuthChallenge` / `SignUp` / `ConfirmSignUp` / `InitiateAuth`
(refresh) / the federated code exchange. This is the single place that knows
about Cognito. Published in the same `@vln-devsecops/auth-lambda` package.

Identity-provider resolution (step 2) needs a lookup: identifier →
{ local | federated-provider }. Options, cheapest first:
- Email-domain → provider mapping (reuse the existing tenants table's
  `emailDomain` index, or a small dedicated map) for federated realms.
- Default to local password when no federation is configured (the common
  single-tenant case), so this stays zero-config until someone wires an IdP.

**`node-vlinder-auth/packages/auth-site`** — rip out the direct Cognito
calls in `main.tsx`/`authConfig.ts`. The SPA becomes: collect identifier →
`POST /auth/identify` → branch on `method` (prompt password vs navigate to
`location`) → on password, `POST /auth/password` → store the returned
vendor-neutral tokens. `authConfig.ts`'s `buildInitiateAuthBody` /
`parseAuthResult` (Cognito-shaped) are deleted. `ui-auth` components stay
mostly as-is (they already emit plain `{ email, password }` callbacks); a new
identifier-first entry component may be warranted.

**`terraform-modules/modules/aws/cognito_auth`** —
- Add the auth Lambda + its `aws/http_api` routes under `/api/v1/auth`
  (public, no authorizer).
- Drop the `/api/v1/idp*` CloudFront behavior, the `idp_proxy_rewrite`
  function, and the direct-IDP custom origin entirely — the SPA no longer
  talks to `cognito-idp.<region>` at all; it only talks to `/api/v1/auth`,
  which is just more admin-api-style HTTP API. This actually *simplifies*
  the distribution (removes the whole `X-Amz-Target` allowlist workaround).
- The `auth_site` app client may switch from `USER_PASSWORD_AUTH` to
  `ADMIN_USER_PASSWORD_AUTH`, since auth now runs server-side in a Lambda
  with admin credentials rather than from the browser.
- `config.json`: the SPA no longer needs `userPoolClientId` (the backend
  holds it) — runtime config may shrink to just the multi-tenant flag.

**e2e** — the flows are the same from the user's point of view (the whole
point), so the Playwright scenarios largely stand. The World's Cognito
`admin-*` setup/teardown stays (that's test scaffolding reaching past the
app deliberately, unaffected by how the app itself authenticates).

## Migration sequencing (keep it green throughout)

1. Land the auth Lambda + `/api/v1/auth` routes **alongside** the existing
   `/api/v1/idp` proxy. Nothing consumes them yet.
2. Move the SPA to `/api/v1/auth` behind the identifier-first flow; keep the
   password path working end to end via the live e2e suite before touching
   federation.
3. Once the SPA no longer calls `/api/v1/idp`, delete the IDP proxy behavior,
   its CloudFront function, and the custom origin.
4. Add federated-IdP resolution + the redirect/callback path as a separate
   increment, with its own e2e scenario (a stub OIDC provider, or a real
   test realm).

## Open questions to settle before building

- **Settled: redirect is a real 302.** Decision (rlc): the federated redirect
  is a genuine `302`, not a `200`-carrying-`location` that the SPA replays —
  handling a redirect inside the React app is brittle and finicky. Reconciled
  with the "can't read a cross-origin redirect out of `fetch`" concern by
  never `fetch`-ing the redirect: `identify` returns a **same-origin**
  `location` (`/api/v1/auth/authorize`), the SPA does a top-level
  `window.location =` navigation to it, and *that* endpoint emits the real
  `302` to the provider, which the browser follows natively. React never has to
  catch or replay a cross-origin redirect.
- **Settled: session is a signed (JWS) self-contained token.** Decision (rlc):
  the `session` passed between `identify` → `password`/`authorize` is a signed
  **JWS** carrying the whole intermediate session state (resolved identifier,
  chosen `method`, resolved federated provider, PKCE/state for the authorize
  step, a short `exp`). Signed, not stored: the auth Lambda stays **stateless**
  — no session table — and the client cannot alter the state and keep it valid.
  Notes: JWS is signed, not encrypted, so its payload is readable by the client
  — put no secrets in it (the identifier is the user's own; that's fine), and
  keep the TTL short since it's an in-flight auth token. Signing key lives with
  the auth Lambda (KMS asymmetric key, or a Secrets Manager HS256 secret);
  KMS-asymmetric keeps the private key out of the function entirely.
- **Settled: federation is configured in the admin panel** (decision: rlc).
  Rather than a Terraform variable (redeploy per change, GitOps-declared), the
  domain→provider mapping is managed at runtime by admins, gated behind a new
  `federation:*` privilege. Proposed UX — a new **Identity Providers** section
  alongside Users/Roles:
  - **List:** each configured provider — display name, protocol (OIDC), the
    email domain(s) that route to it, enabled/disabled.
  - **Add / edit provider form:** display name; OIDC **discovery URL**
    (`…/.well-known/openid-configuration`); client id; **client secret**
    (write-only field — stored in Secrets Manager, never read back, rendered as
    "••• set" with a "replace" action); scopes; and the email domain(s) mapped
    to this provider.
  - **Validation:** on save the auth/admin backend fetches the discovery URL to
    confirm it resolves, and enforces domain-mapping uniqueness (one domain →
    one provider).
  - **Enable/disable** toggle so a provider can be staged before it goes live.

  Storage: non-secret provider config in a new CMK-encrypted
  `identity_providers` table (in multi-tenant mode the domain mapping reuses the
  tenants table's existing `emailDomain` index that already resolves a user's
  tenant at signup); the **client secret in Secrets Manager**, referenced by
  ARN. The admin-api Lambda writes config + secret; the auth Lambda reads the
  mapping (and the secret, for the code exchange) at `identify`/`callback` time.
  Trade-off of admin-managed vs module-variable: runtime-editable with no
  redeploy and self-service per tenant, at the cost of a larger privileged
  write surface to secure (hence the dedicated `federation:*` privilege and
  write-only secret handling) — acceptable, and consistent with roles/users
  already being runtime-managed here.
- **Token delivery/storage — trade-offs (decision pending).** The realistic
  browser threat is XSS, and that's what splits the two options:
  - **`sessionStorage` (today's baseline).** Simple: the SPA reads the token
    and sets `Authorization: Bearer` itself, which is exactly what the admin
    API's API-Gateway JWT authorizer already expects. No CSRF exposure (nothing
    is auto-sent). *But* the token is readable by any JS on the page, so a
    single XSS exfiltrates it — worst for the long-lived refresh token.
  - **httpOnly cookie set by the backend.** `HttpOnly` puts the token out of
    JS's reach, so XSS can't read it — the main security win, and it matters
    most for the refresh token. Because the whole app is one first-party
    same-origin surface behind CloudFront (`/api/v1/*`), the cookie is sent
    automatically with no header plumbing in the SPA, and `SameSite=Strict` +
    `Secure` is fully viable (no legitimate cross-site use), which closes most
    of the CSRF exposure that cookies normally reintroduce; add a double-submit
    CSRF token on state-changing routes for belt-and-suspenders. Two real
    costs: (1) the admin API's JWT authorizer reads the `Authorization` header,
    not a cookie, so cookie sessions require either a Lambda authorizer that
    reads the cookie or an edge function that copies cookie→header — i.e. this
    is coupled to the authorizer-issuer item below and should land with it; and
    (2) a JWT in a cookie must stay under the ~4 KB limit (watch a large
    `permissions` claim).

  **Recommendation:** move to `HttpOnly` + `SameSite=Strict` + `Secure`
  cookies as part of the auth-Lambda work — it's a clear XSS win on an
  already-same-origin design — but land it together with the authorizer change
  (next item), and keep `sessionStorage` as the baseline until that pair ships.
  **Confirm the direction.**
- **Acknowledged: the admin API authorizer must move with the IdP** (decision:
  rlc — keep in view). Even behind a vendor-neutral front door the admin API
  authorizes against Cognito-issued JWTs today; if the IdP is later swapped,
  the authorizer's issuer/JWKS must move too, or we've vendor-neutralized the
  front door while leaving Cognito hard-wired at the back. This is the same
  authorizer touched by the token-storage decision above (cookie sessions need
  the authorizer to read a cookie, not a Bearer header), so both changes land
  together in the federation increment — noted, not blocking the first
  password-flow increment.
