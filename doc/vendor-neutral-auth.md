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
- **Federation config surface.** How a consumer declares "email domain X
  federates to OIDC provider Y" — a new module variable, and where the
  provider secrets live (Secrets Manager).
- **Token delivery/storage.** Same open item as today (sessionStorage vs
  httpOnly cookie); the vendor-neutral API is a natural place to move to
  httpOnly-cookie sessions set by the backend, which also improves security —
  worth deciding here rather than carrying the sessionStorage baseline
  forward.
- **Does the admin API's JWT authorizer stay Cognito-issued?** Even with a
  vendor-neutral front door, the admin API currently authorizes against
  Cognito-issued JWTs. If the identity provider is later swapped, the
  authorizer's issuer/JWKS must move too — keep this in view so we don't
  vendor-neutralize the front door while leaving Cognito hard-wired at the
  back.
