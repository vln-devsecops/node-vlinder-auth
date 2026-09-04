# Rationale

Why the system is shaped the way it is. [`architecture.md`](./architecture.md)
and [`vendor-neutral-auth.md`](./vendor-neutral-auth.md) describe *what* is
built; this file records *why*, including the alternatives that were weighed
and rejected. Anything actively being built or still undecided lives in
[`plan.md`](./plan.md), not here.

Nothing in this system is deployed yet. There is no installed base, no
backwards compatibility to preserve, and no "current behaviour" worth
protecting — where a decision below reads as a change, it is a change to a
design, not to a running system.

## Platform

### Own login UI, not Cognito's Managed Login

Managed Login gives the OIDC authorization endpoint and native federation for
almost no code, but it is a hosted page that can only be themed, not rebuilt,
and it cannot express identifier-first home-realm discovery — it shows one
combined username+password+IdP-buttons screen with no email-domain routing.
Keeping our own UX rules it out.

The cost is that Cognito's hosted-only features become unavailable, so we
build the interactive parts ourselves: a slim `/authorize` + `/token` handoff,
and self-driven federation where the auth Lambda is itself the OIDC client to
each external IdP.

### Cognito stays, as a credential store and token signer

Even reduced to "own UI + thin handoff + self-driven federation", Cognito
still provides the primitives worth not hand-rolling: password storage and
verification, token signing with published, rotated JWKS, MFA, the
sign-up/verification/reset state machines, adaptive security, refresh-token
lifecycle, and the trigger hooks the RBAC seam depends on.

What it stops providing is exactly what we opt out of: the hosted UI, the
interactive `/oauth2/authorize` endpoint, and native federation.

### The client code must not depend on Cognito, but Cognito is not a secret

That Cognito sits behind `auth.<zone>` is public information — RP backends
validating a token against Cognito's issuer is fine. What must not happen is
any client or RP code depending on Cognito's *API shapes*: no
`X-Amz-Target`, no Cognito request/response envelopes, no Cognito flow names.
The boundary is the first-party `/api/v1/auth` contract; behind it, the engine
is replaceable without touching a single consumer.

### Tokens are Cognito's real tokens, not re-minted by us

Re-signing tokens at `auth.<zone>` would make the issuer ours and therefore
portable across a future engine swap. It was rejected for this phase: it
needs new signing-key infrastructure and its own JWKS/discovery endpoints, and
nothing currently consumes it. The cost — every RP is wired to Cognito's
specific, non-relocatable issuer identity — is accepted for now and tracked in
[`follow-ups/self-issued-tokens.md`](./follow-ups/self-issued-tokens.md).

## Token delivery

### The ID token is readable by browser JS; the refresh token never is

These are different risks and get different answers.

The **ID token** drives what the UI shows — which controls to render, which
actions to offer, whether an action needs a step-up first. That is a
front-end concern by nature, and a design that hides it forces a server
round-trip for every UI decision. It is readable by JS deliberately.

The **refresh token** has no legitimate client-side use at all. It is
long-lived, and a stolen copy is replayable for its full lifetime. It is
JWE-wrapped by the auth service (opaque even to the BFF that stores it) and
lives only in an `HttpOnly` cookie on the BFF's own origin.

The **access token** sits between the two, so it is a **BFF configuration
option, defaulting to cookie-only**. An app with no cross-origin API calls
never needs it in JS; an app that must send it as a bearer token to another
origin opts in. Defaulting to the safer setting means an adopter who never
thinks about this question still ships the better posture, and the ones who
opt in are the ones who had a reason to. Short lifetimes plus refresh
rotation are what make opting in acceptable — not an argument that XSS
doesn't matter.

The default has a cost worth stating plainly: it makes the BFF's own API
cookie-authenticated, which is exactly the shape CSRF exploits. A bearer
token in a header is CSRF-immune by construction because only the app's own
JS can set it; a cookie the browser attaches automatically is not.

### Double-submit CSRF protection is on by default

Because cookie-only is the default, *every* adopter's BFF is
cookie-authenticated unless they deliberately opt out. That makes the CSRF
surface universal rather than hypothetical, so the mitigation is on by
default too: a second, JS-readable cookie echoed back in a custom header on
state-changing requests, rejected on mismatch. A cross-site `<form>` can
neither set a custom header nor read a cookie value to forge one.

This applies to **both** cookie-authenticated surfaces: every adopter's BFF,
and the admin API, which is cookie-authenticated too (the AS session cookie,
lifted to a bearer header at the edge). One posture, one design to review.

It reverses the reasoning that previously deferred double-submit on the admin
API — that speculative security code with no caller rots. That argument holds
while the exposure is conditional, which it was: the admin API exposes no
form-submittable route, so the gap double-submit would close did not yet
exist. It does not hold once cookie authentication is the default everywhere.
`SameSite` alone is not something to lean on either, because it depends on
every current and future browser enforcing it correctly.

The token is bound to the session (`HMAC(session-id, secret)`) rather than a
bare random value, so it cannot be forged by anyone who can merely set a
cookie on the origin. That matters little for a single origin and costs
nothing to do properly from the start.

### PKCE material is minted by the client app's back-end, not its front-end

A public-client SPA that mints its own `code_verifier` is a legitimate OAuth
pattern, but it only makes sense when there is no back-end — when the
resources being protected live in the SPA itself. As soon as the app has a
back-end, the back-end is the thing doing the protecting, and it should hold
the PKCE material. The front-end only navigates to a same-origin
`/login` route on its own app.

### `state` is a JWE, not a JWS

The identify-session cookie is a JWS: signed, readable, tamper-evident — its
payload is the user's own identifier and their in-flight request, so
confidentiality buys nothing.

`state` is different: it carries `code_verifier`, which PKCE's entire security
model depends on staying secret from anyone who can observe the redirect.
`state` round-trips through browser history, `Referer` headers and proxies —
precisely the interception surface PKCE defends against. A signed-but-readable
`state` would defeat the purpose, so it is encrypted.

Direct symmetric encryption (`alg: dir`, `enc: A256GCM`) keeps it small: the
same service encrypts and decrypts, so there is no key exchange to justify a
key-wrapping algorithm. The compact serialization runs about 180 characters
for a `code_verifier` plus timestamp — comfortably inside any URL length
limit, and no server-side session store.

### The one-time token is not tracked for single use

It is short-lived and bound to `(user, redirect_uri, code_challenge)`, but
nothing records that it has been redeemed. Genuine single-use enforcement
needs shared state to check against, which this flow otherwise avoids
entirely.

The exposure is acceptable because the only party that can redeem the token is
whoever holds the matching `code_verifier`, and that never left the client
app's own back-end. There is no external replay threat; the sole party capable
of replaying it is the party the token was issued to.

### The one-time token carries `redirect_uri`, so `/token` need not resend it

Standard OAuth requires the token request to repeat `redirect_uri` because a
plain authorization code is an opaque random string with no way to recall what
it was bound to without a server-side lookup. A self-describing encrypted
token has no such problem — the binding travels inside it.

### Refresh tokens rotate, and the front-end must single-flight refreshes

Rotation plus Cognito's reuse detection bounds a stolen refresh token to a
single race rather than unlimited use for its lifetime.

The cost lands on consuming front-ends: several parallel API calls hitting
`401` at once, each independently triggering a refresh, will race — the second
presents an already-superseded token, reuse detection fires, and a legitimate
user's whole token family is revoked. Coalescing concurrent refreshes into one
in-flight call is therefore a requirement on every consuming front-end, not an
optimization. Neither the BFF nor the auth service can enforce it from their
side.

### Elevated grants decay by wall-clock expiry, not a refresh countdown

A per-privilege refresh countdown ties an elevated grant's survival to how
often the client happens to refresh, so a chatty session burns through it
faster than an idle one — backwards from what "good for twenty minutes"
should mean. Expiry is activity-independent and matches how every other
short-lived token here already works.

Grants decay per-privilege rather than per-role because a decay policy only
means anything at the granularity of the thing being decayed. The data rides
inside the refresh token's own encrypted payload, reusing the rotation that
already happens on every refresh rather than adding a store.

### Step-up proof depends on how the session authenticated

For a local password login, `/sudo` requires re-entering the password — that
is what makes it a step-up rather than a permissions toggle. But the password
cannot be collected by the client app's front-end: the whole reason we own the
login UI is that a user's real password never passes through arbitrary
third-party RP frontends. So it is a small `auth.<zone>`-hosted redirect,
structurally the login flow in miniature, not an in-app modal (which our own
anti-framing headers would block anyway).

For a federated login it degrades to a confirmation dialog, because there is
no way to force re-authentication at the external IdP (below). Nothing secret
is being collected, so an in-app dialog is fine there.

This means the AS session must record *how this session authenticated* — a
user may hold both a local password and a linked federated identity, so it is
a property of the session, not the account.

## Logout

### Logout revokes; it does not merely forget

Clearing the BFF's cookie only discards its own copy and leaves the underlying
Cognito refresh token valid until natural expiry — which matters if a copy
leaked some other way. Logout therefore revokes at Cognito before clearing
anything locally.

Ordinary logout is scoped to the requesting app: it revokes that app's refresh
token and leaves the `auth.<zone>` SSO session intact for the user's other
apps. "Logout everywhere" calls `GlobalSignOut`, which invalidates every
refresh token issued to that user across every client.

### Ending SSO requires a call the browser itself makes

The AS session cookie is scoped to `auth.<zone>`'s origin and lives in the
user's browser. A `Set-Cookie` in a response to the *BFF* never reaches the
browser — the BFF is not the browser and cannot relay cookies backward across
origins. Only a credentialed request the browser itself makes to
`auth.<zone>` can clear it.

### The federated logout gap is accepted, not solved

Neither `GlobalSignOut` nor clearing the AS session touches the external IdP's
own session. If a user's Google session is still alive, the next login
resolves to Google, redirects, and is silently re-authenticated with no
prompt — which defeats the shared-device case "logout everywhere" exists for.

Two ways to close it were examined and both rejected:

- **Redirect to the IdP's own logout endpoint.** Requires a real top-level
  navigation, likely signs the user out of that IdP *entirely* (Gmail,
  YouTube, everything else in other tabs — far past what our button implies),
  and return-redirect support varies by provider.
- **`prompt=login` on the federated authorization request.** Verified against
  Google's own OpenID Connect documentation: the only supported `prompt`
  values are `none`, `consent`, and `select_account`. `login` is not among
  them. The OIDC fallback for the same goal, `max_age=0`, does not help
  either — Google is a documented case of an OP that does not implement
  `max_age` correctly.

So there is no narrowly-scoped lever. The gap is documented and accepted.
Reconfirm before relying on it either way; IdP behaviour changes.

## Authorization

### Role and privilege are strictly separate, and only privileges reach a token

An application defines a role catalog; roles resolve to privileges at token
issuance and the role name never appears in a token. Downstream services
reason only about privileges, so an app can restructure its role catalog
without changing what anything downstream checks.

### The token is authoritative

A token is minted by the auth Lambda through Cognito and states exactly what
its bearer may do. It carries no role names, and there is no second input to
reconcile it against — effective access is whatever the token says it is. A
resource server validates the token and reads its scopes; it does not re-derive
anything from a role catalog or a database.

Because the ID token deliberately carries a *superset* of the access token's
scopes, a resource server must check `token_use` and reject anything that is
not an access token. Cognito signs both with the same key, so signature,
issuer and expiry checks alone cannot tell them apart — accepting an ID token
where an access token belongs would hand a caller every privilege the step-up
flow exists to gate.

### `client_id` resolves the tenant; email domain resolves the identity provider

These are two different lookups and conflating them was an early mistake. The
calling application's `client_id` determines which tenant a login belongs to.
Within that tenant, the user's email domain determines which identity provider
they must use — a tenant's domain owner can pin their users to a corporate IdP
so that removing someone there removes their access here.

A consequence: navigating to `auth.<zone>` without a `client_id` identifies no
tenant, so it is only meaningful for surfaces that belong to the auth
component itself — the admin panel, and later a user profile. Those get the
auth application's own tenant.

Tenant assignment happens in both tenancy modes. Single-tenant mode differs
only by the absence of tenant CRUD; every user still lands in a tenant.

### Privilege strings are `verb:tenant-id:resource-glob`

Globs are gitignore-style: `*` matches within a path segment, `**` traverses
segments. When the tenant is irrelevant, `verb:resource-glob`,
`verb::resource-glob` and `verb:*:resource-glob` are equivalent spellings. A
bare `verb` with no resource is invalid — a privilege always says what it acts
on.

## Delivery

### Lambda source is a published package, not vendored source

The module stays self-contained at apply time while the code stays properly
TDD'd in a real TypeScript project, with version bumps flowing through
Dependabot rather than copy-paste.

### We ship a reference BFF, not just a specification

This design puts real requirements on the consuming app's back-end: PKCE
minting, encrypted `state`, cookie handling, single-flight refresh, the sudo
and logout relays. Leaving every adopter to reimplement that correctly from
prose is how subtle auth bugs get shipped. A minimal but fully functional BFF
implementation lives in this repo and is the reference every adopter starts
from.

### Onboarding is encapsulated so it can become no-code later

Tenant, client and identity-provider registration is deliberately kept behind
a narrow interface rather than spread across Terraform variables and manual
steps, so a self-service onboarding UI can be built on top of it without
reworking the model underneath.

### A dedicated CMK for the role-assignments table

It is the sensitive table; a compromise of a shared key should not expose it.

### Verification codes, and links are possible too

We generate and store the verification code ourselves rather than relying on
Cognito to generate one, because Cognito never exposes its own code to any
trigger. Since the code is ours, a verification *link* embedding it is equally
available — the earlier constraint that ruled links out (they required a
Cognito Hosted UI domain we deliberately do not create) no longer applies.
