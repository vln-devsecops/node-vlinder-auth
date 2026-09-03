# Living plan

The standing work queue for the auth component. This file is the source of
truth for progress, not conversation memory — sessions implementing it may be
far apart and start cold.

- **What** is built: [`architecture.md`](./architecture.md) and
  [`vendor-neutral-auth.md`](./vendor-neutral-auth.md).
- **Why** it is shaped that way: [`rationale.md`](./rationale.md).
- **Order and status**: this file.

## How to use this plan

1. Pick **one** step whose prerequisites are met. Don't chain into the next
   one unannounced.
2. Implement it TDD-first, matching the conventions already in the package you
   are touching.
3. Update this file: tick the step's boxes, move it to `done`, append a dated
   entry to the [progress log](#progress-log). Convert relative dates to
   absolute.
4. Open a PR and **confirm CI is clean before calling the step done** —
   passing tests locally is not the same as a clean pipeline. Check
   `gh pr checks`, and verify the reported head SHA matches your branch's HEAD
   before trusting the result.
5. Stop for review.

If a step turns out to be wrong or a decision needs revisiting, update
[`rationale.md`](./rationale.md) with the new decision and its reasoning
rather than leaving a correction note in the spec docs. The specs describe the
intended system in its final form; they should never accumulate a history of
how they got there.

### Which model for which step

Each step below carries a recommendation. The heuristic:

| | Implementation | Review |
| --- | --- | --- |
| **Sonnet** | Well-specified work with a clear target: Terraform wiring, test writing, refactors against a settled spec, doc updates, packaging. | Mechanical correctness, convention conformance, test coverage. |
| **Opus** | Steps marked **security-critical** — anything minting, encrypting, validating or scoping a token. | **Required** on every security-critical step, and on any step that changes the privilege model, token contents, or what a resource server trusts. Also worth it for cross-cutting consistency passes. |

A Sonnet session may implement a security-critical step; the *review* is what
must be Opus. When in doubt about whether a change is security-critical, ask:
*if this were subtly wrong, would it grant access that should have been
denied?* If yes, it is.

## Current state

Nothing is deployed. There is no installed base and no backwards
compatibility to preserve.

Built and merged: the auth Lambda and the full `/api/v1/auth` self-service
surface (identify, password, signup, confirm, resend, forgot, reset) with
app-owned verification codes; the RBAC tables and triggers; the admin API and
panel; the auth-site SPA on `AuthChrome` with runtime-injected branding; the
BDD e2e suite covering sign-in, sign-up, verification and password reset
against a real deployment.

The design has since moved on in ways the code has not yet caught up with —
the client registry, the tenant/IdP split, the RP handoff, the token split and
the step-up flow are all specified but unbuilt. That gap is what the steps
below close.

Prior plan: [`plan-auth-chrome-and-verification-codes.md`](./plan-auth-chrome-and-verification-codes.md)
is complete except its final verification pass, folded in as step 0 below.
It is kept for its progress log and is not otherwise live.

## Open questions

Settle these before the steps that depend on them; each names its dependant.

- **Does `/whoami` survive?** Now that the ID token is readable by front-end
  JS and carries the full scope set, a front-end can diff ID-vs-access locally
  and never call `/whoami`. Keeping it as the server-side source of truth is
  still defensible (grants can change server-side mid-session, and the admin
  panel may prefer it), but it may be redundant. *Blocks: step 9.*
- **Do we offer verification links as well as codes?** Now possible, since we
  generate the code ourselves. Purely a product call. *Blocks: nothing;
  decide before step 12's e2e coverage is written.*
- **Does the reference BFF expose the access token to JS by default?** The
  option exists either way; the default shapes what most adopters ship.
  *Blocks: step 8.*

## Steps

### 0. Close out the prior plan — Sonnet / Sonnet

- [ ] Full-suite verification: `npm run test --workspaces --if-present`,
      `cd e2e && npm test`, lint, `tsc --noEmit` across workspaces.
- [ ] Eyeball `design_handoff_auth_chrome/`'s mockups against the deployed
      `AuthChrome`, then delete that directory (it exists only for that check).
- [ ] Confirm the SonarQube baseline is clean — zero new *and* zero remaining
      baseline findings.

### 1. Privilege model — Sonnet / **Opus (security-critical)**

Breaking change to how every privilege is written and matched.

- [ ] Adopt `verb:tenant-id:resource-glob` throughout, with gitignore-style
      globbing (`*` within a segment, `**` across). Treat
      `verb:resource-glob`, `verb::resource-glob` and `verb:*:resource-glob`
      as equivalent; reject a bare `verb`.
- [ ] Write the matcher TDD-first, including the traversal boundary cases —
      this is where a subtle bug grants access it shouldn't.
- [ ] Emit scopes as a **space-separated** OAuth `scope` claim, not
      comma-joined `permissions` (`pre-token-generation/handler.ts`).
- [ ] Replace `admin-api/authz.ts`'s role-vs-scope intersection with plain
      scope matching: the token is authoritative and carries no roles.
- [ ] Update the seeded role catalog, every fixture, and the privilege tables
      in `use-cases/README.md` to the new form.

### 2. Client registry and tenancy resolution — Sonnet / **Opus**

- [ ] `client_id → tenant_id` registry; `(email_domain, tenant_id) →
      identity provider` mapping. Extend the tenants table rather than
      inventing a parallel store.
- [ ] Resolve the tenant from `client_id` at `/authorize`; resolve the
      provider from email domain at `/identify`, falling back to the tenant's
      defaults when no provider is pinned.
- [ ] Give the auth application its own tenant, so `auth.<zone>` reached
      without a `client_id` (admin panel, later user profile) still resolves.
- [ ] Confirm single-tenant mode still assigns a tenant; it differs only by
      exposing no tenant CRUD.
- [ ] Keep registration behind a narrow interface so no-code onboarding can be
      layered on later.

### 3. Stop stripping `/api/v1` — Sonnet / Sonnet

- [ ] Include the prefix in the API Gateway routes for both APIs.
- [ ] Delete `auth_api_rewrite` entirely; reduce `admin_api_rewrite` to the
      cookie lift and the `x-origin-verify` strip, with no URI rewrite.
- [ ] Contract-test that no CloudFront function rewrites an API URI, so a
      future `/api/v2` can be routed alongside.

### 4. Edge response headers — Sonnet / Sonnet

- [ ] `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors
      'none'` on the default behavior, via a response-headers policy.
- [ ] Explicit contract tests for both. File the tracking issue on
      `workspace-vlinder-auth`.

### 5. Split ID and access token claims — Sonnet / **Opus (security-critical)**

- [ ] `pre-token-generation` resolves twice: the full held-plus-active set for
      the ID token, the active-only set for the access token. It already runs
      on the V2 event, which supports diverging the two.
- [ ] Test that a held-but-inactive privilege appears on the ID token and
      **never** on the access token.

### 6. RP handoff: `/authorize` + `/token` — Sonnet / **Opus (security-critical)**

- [ ] One-time token as `jwe({user, redirect_uri, code_challenge, timestamp})`
      — `alg: dir`, `enc: A256GCM`, key held by the auth Lambda.
- [ ] PKCE verification: `base64url(sha256(code_verifier))` against the
      embedded challenge, plus expiry. Require `code_challenge_method=S256`.
- [ ] `client_id`/`redirect_uri` allowlist validation at `/authorize`.
- [ ] Extend the identify-session JWS to carry `redirect_uri`,
      `code_challenge` and the RP's `state` across identify → password.
- [ ] Record `authMethod` (`local` | `federated`) on the AS session — step 9
      depends on it.

### 7. Refresh: JWE wrapping, rotation, grant container — Sonnet / **Opus**

- [ ] Wrap Cognito's refresh token in a JWE the BFF cannot read; rotate it on
      every refresh; enable Cognito rotation with reuse detection.
- [ ] Carry an `elevatedGrants` list in the payload and decay expired entries
      on every refresh, before computing the access token's scopes.
- [ ] `401` on an expired or revoked refresh token, so the BFF can clear its
      cookie and propagate.

### 8. Reference BFF — Sonnet / Sonnet

*Depends on the open question about the access token's default exposure.*

- [ ] A minimal but fully functional BFF in this repo: PKCE minting, encrypted
      `state`, the callback exchange, the refresh-token cookie, and relays for
      `/sudo`, `/whoami` and `/logout`.
- [ ] A front-end client helper that single-flights refreshes.
- [ ] Configuration switch for whether the access token reaches JS.
- [ ] Publish it dual ESM+CJS like the other packages.

### 9. Step-up — Sonnet / **Opus (security-critical)**

*Depends on the open question about `/whoami`.*

- [ ] `POST /sudo`: re-check the grant against `user_role_assignments`, mint an
      elevated access token and a rotated refresh token carrying the grant's
      expiry. Activation never creates a grant.
- [ ] Local sessions redirect to an `auth.<zone>`-hosted password
      confirmation; federated sessions take an in-app confirmation only.
- [ ] `escalatable` on privilege-failure responses from the admin API, as the
      worked example for adopters' own resource servers.
- [ ] Test that expiry is silent and that a re-run resets rather than stacks.

### 10. Logout and session termination — Sonnet / Sonnet

- [ ] `POST /logout` revokes at Cognito before anything is cleared locally;
      `{ everywhere: true }` calls `GlobalSignOut`.
- [ ] `POST /session` for the browser-initiated AS session clear, with CORS
      for allowlisted origins.
- [ ] Admin panel and admin API can terminate all of a user's sessions.

### 11. Self-driven federation — Sonnet / **Opus**

- [ ] `GET /federation` with `provider` and `action=start|callback`.
- [ ] Our own `state` and `nonce` in the identify-session JWS; validate the
      provider's ID token (signature, `aud`, `iss`, `nonce`) on callback.
- [ ] Provision or link the Cognito user, running the same tenant resolution
      and initial role assignment as local signup.
- [ ] Admin-managed provider configuration behind `admin:federation`, with
      client secrets write-only in Secrets Manager.

### 12. End-to-end coverage — Sonnet / Sonnet

- [ ] Drive the full RP handoff in the live suite against the reference BFF.
- [ ] Federation against a stub OIDC provider or a real test realm.
- [ ] Step-up, expiry-drop, ordinary logout and logout-everywhere.
- [ ] Reconcile with `workspace-vlinder-auth`'s `features/` scenarios.

## Backlog

Not scheduled; pick up when the trigger arrives.

- **Self-issued tokens** — [`follow-ups/self-issued-tokens.md`](./follow-ups/self-issued-tokens.md).
  Trigger: a second identity engine, or an external RP that shouldn't be
  handed AWS-specific issuer details.
- **No-code onboarding** — a self-service UI over the tenant/client/provider
  registration interface step 2 keeps narrow.
- **User profile surface** on `auth.<zone>`'s own tenant (avatars and the
  like).
- **Dual ESM+CJS retrofit** for `auth-lambda` and `auth-ui`
  (`node-vlinder-auth#86`), and for `http-api-authorizer-lambda`
  (`node-http-api-authorizer#16`).

## Progress log

Oldest first. One entry per step completed, with what was deliberately *not*
done alongside what was.

- **2026-09-03** — Documentation restructured after a design review. The two
  specs were rewritten to describe the intended system directly rather than
  carrying the history of how each decision was reached; that history moved to
  `rationale.md`. This plan replaced the ad-hoc migration sequencing that had
  been living inside `vendor-neutral-auth.md`. Review corrections folded into
  the specs: `client_id` resolves the tenant while email domain resolves the
  identity provider (previously conflated); the ID token is readable by
  front-end JS and the access token's exposure is a BFF option (previously
  "no token touches browser JS"); privileges are
  `verb:tenant-id:resource-glob` with gitignore globbing; scopes are
  space-separated; the token is authoritative with no role-vs-scope
  intersection; `/api/v1` is preserved end to end; federation is a resource
  with the step as a parameter; we ship a reference BFF. No code changed —
  steps 1-12 above are the resulting gap.
