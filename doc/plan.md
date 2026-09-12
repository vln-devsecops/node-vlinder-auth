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
the client registry, the tenant/IdP split, the RP handoff, the token split,
the step-up flow and the OIDC discovery document are all specified but
unbuilt. That gap is what the steps below close.

Prior plan: [`plan-auth-chrome-and-verification-codes.md`](./plan-auth-chrome-and-verification-codes.md)
is complete except its final verification pass, folded in as step 0 below.
It is kept for its progress log and is not otherwise live.

## Open questions

None open. Add them here when they block a step, naming the dependant step;
move the answer into [`rationale.md`](./rationale.md) once settled, rather
than leaving the question and its resolution here.

## Steps

### 0. Close out the prior plan — Sonnet / Sonnet

- [x] Full-suite verification: `npm run test --workspaces --if-present`,
      `cd e2e && npm test`, lint, `tsc --noEmit` across workspaces.
- [x] Eyeball `design_handoff_auth_chrome/`'s mockups against the deployed
      `AuthChrome`, then delete that directory (it exists only for that check).
- [x] Confirm the SonarQube baseline is clean — zero new *and* zero remaining
      baseline findings.

### 1. Privilege model — Sonnet / **Opus (security-critical)**

Breaking change to how every privilege is written and matched.

- [x] Adopt `verb:tenant-id:resource-glob` throughout, with gitignore-style
      globbing (`*` within a segment, `**` across). Treat
      `verb:resource-glob`, `verb::resource-glob` and `verb:*:resource-glob`
      as equivalent; reject a bare `verb`.
- [x] Write the matcher TDD-first, including the traversal boundary cases —
      this is where a subtle bug grants access it shouldn't.
- [x] Emit scopes as a **space-separated** OAuth `scope` claim, not
      comma-joined `permissions` (`pre-token-generation/handler.ts`).
- [x] Replace `admin-api/authz.ts`'s role-vs-scope intersection with plain
      scope matching: the token is authoritative and carries no roles.
- [x] Update the seeded role catalog, every fixture, and the privilege tables
      in `use-cases/README.md` to the new form.

### 2. Client registry and tenancy resolution — Sonnet / **Opus**

- [x] `client_id → tenant_id` registry; `(email_domain, tenant_id) →
      identity provider` mapping. Extend the tenants table rather than
      inventing a parallel store.
- [x] Resolve the tenant from `client_id` at `/authorize`; resolve the
      provider from email domain at `/identify`, falling back to the tenant's
      defaults when no provider is pinned. (`/authorize` itself is step 6,
      unbuilt -- the resolution function is ready for it; wired live at
      `/identify`, which already exists.)
- [x] Give the auth application its own tenant, so `auth.<zone>` reached
      without a `client_id` (admin panel, later user profile) still resolves.
- [x] Confirm single-tenant mode still assigns a tenant; it differs only by
      exposing no tenant CRUD.
- [x] Keep registration behind a narrow interface so no-code onboarding can be
      layered on later.

### 3. Stop stripping `/api/v1` — Sonnet / Sonnet

- [x] Include the prefix in the API Gateway routes for both APIs.
- [x] Delete `auth_api_rewrite` entirely; reduce `admin_api_rewrite` to the
      cookie lift and the `x-origin-verify` strip, with no URI rewrite.
- [x] Contract-test that no CloudFront function rewrites an API URI, so a
      future `/api/v2` can be routed alongside.

### 4. Edge response headers — Sonnet / Sonnet

- [x] `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors
      'none'` on the default behavior, via a response-headers policy.
- [x] Explicit contract tests for both. File the tracking issue on
      `workspace-vlinder-auth`
      ([#5](https://github.com/vln-devsecops/workspace-vlinder-auth/issues/5)
      — whether the `/api/v1/*` API behaviors need their own header posture).

### 4a. Publish the OIDC discovery document — Sonnet / **Opus (security-critical)**

The published `issuer`/`jwks_uri` are what every resource server pins against.
Nothing exists today: `config.json` carries no issuer, and the Terraform
`issuer_url` output is deploy-time wiring, not a runtime contract — with only
that, changing the signing engine means every relying party re-applies in
lockstep. Prerequisite for steps 5, 6 and 8, which all assume consumers can
discover what to trust. Reasoning in [`rationale.md`](./rationale.md) ("The
expected issuer is configuration, not a constant").

- [x] Terraform writes `.well-known/openid-configuration` into the auth-site
      S3 origin via `local_file`, exactly as it already does `config.json` —
      every value is a per-deployment constant known at apply time.
- [x] Populate `issuer` and `jwks_uri` from the existing
      `local.admin_api_issuer_url` (Cognito's real endpoints — **no mirror**,
      so key rotation can never be served stale), plus the first-party
      `authorization_endpoint`, `token_endpoint` and `end_session_endpoint`.
- [x] Exempt `/.well-known/*` from `spa_viewer_request`. That path is
      extensionless by specification, so the SPA fallback currently captures
      it and returns `index.html` with a `200` — a failure that looks like
      success to every consumer. Contract-test the exemption specifically.
- [x] Serve it public, cacheable and CORS-open (`Access-Control-Allow-Origin:
      *`); it carries nothing secret and browser-side consumers must reach it.
- [x] Contract-test that `issuer` is derived from this module's own user pool
      and that `jwks_uri` resolves, mirroring
      `identity.tftest.hcl`'s existing `issuer_url` assertions.
- [x] Cover it in the e2e suite: fetch the document against a real deployment
      and validate a live access token's `iss` against the value it publishes,
      rather than against a constant in the test.
- [x] Update the `vlinder_auth` README: `issuer_url` is convenience for wiring
      a JWT authorizer in the same apply, **not** the integration contract.
- [x] Document the spec deviation where integrators will hit it — the
      document's `issuer` will not match its host until self-issuance, so
      strict OIDC libraries reject it. Already written up in
      [`vendor-neutral-auth.md`](./vendor-neutral-auth.md); make sure the
      module README says it too.

### 5. Split ID and access token claims — Sonnet / **Opus (security-critical)**

- [x] `pre-token-generation` resolves twice: the full held-plus-active set for
      the ID token, the active-only set for the access token. It already runs
      on the V2 event, which supports diverging the two.
- [x] Test that a held-but-inactive privilege appears on the ID token and
      **never** on the access token.

### 6. RP handoff: `/authorize` + `/token` — Sonnet / **Opus (security-critical)**

- [x] One-time token as `jwe({user, redirect_uri, code_challenge, timestamp})`
      — `alg: dir`, `enc: A256GCM`, key held by the auth Lambda.
- [x] PKCE verification: `base64url(sha256(code_verifier))` against the
      embedded challenge, plus expiry. Require `code_challenge_method=S256`.
- [x] `client_id`/`redirect_uri` allowlist validation at `/authorize`.
- [x] Extend the identify-session JWS to carry `redirect_uri`,
      `code_challenge` and the RP's `state` across identify → password.
- [x] Record `authMethod` (`local` | `federated`) on the AS session — step 9
      depends on it.

### 7. Refresh: JWE wrapping, rotation, grant container — Sonnet / **Opus**

- [ ] Wrap Cognito's refresh token in a JWE the BFF cannot read; rotate it on
      every refresh; enable Cognito rotation with reuse detection.
- [ ] Carry an `elevatedGrants` list in the payload and decay expired entries
      on every refresh, before computing the access token's scopes.
- [ ] `401` on an expired or revoked refresh token, so the BFF can clear its
      cookie and propagate.

### 8. Reference BFF — Sonnet / **Opus (security-critical)**

- [ ] A minimal but fully functional BFF in this repo: PKCE minting, encrypted
      `state`, the callback exchange, the refresh-token cookie, and relays for
      `/sudo`, `/whoami` and `/logout`.
- [ ] A front-end client helper that single-flights refreshes.
- [ ] Configuration switch for whether the access token reaches JS,
      **defaulting to cookie-only**. Opting in is for apps that must send it
      cross-origin as a bearer token.
- [ ] **Double-submit CSRF protection on by default**, not deferred until a
      form-submittable route exists. A second cookie (`Secure`,
      `SameSite=Strict`, deliberately *not* `HttpOnly`) alongside the
      refresh-token cookie; the client helper echoes it in a custom header on
      every state-changing request; the BFF rejects any mismatch. Bind it to
      the session (`HMAC(session-id, secret)`) rather than a bare random
      value. Design already worked out in `terraform-modules`'
      `modules/aws/vlinder_auth/doc/admin-api-csrf.md` — implement that here,
      always on, with disabling it a documented deviation rather than a
      routine option.
- [ ] Publish it dual ESM+CJS like the other packages.

### 8a. Double-submit on the admin API — Sonnet / **Opus (security-critical)**

Double-submit is the standing posture for **both** cookie-authenticated
surfaces, not just adopter BFFs. The admin API is cookie-authenticated too
(the AS session cookie, lifted to a bearer header at the edge), so it gets
the same protection rather than continuing to rest on `SameSite` plus an
enforced no-`POST`-routes invariant.

- [ ] Implement double-submit on the admin API, matching the BFF's scheme so
      there is one design to review, not two.
- [ ] Rewrite `admin-api-csrf.md` in `terraform-modules`: its "not built now,
      no caller" framing and its "if a POST route is ever needed" trigger both
      stop being true once this is unconditional.
- [ ] **Keep** `admin_api_never_exposes_a_post_route`. Double-submit does not
      make it redundant: it stays as defence in depth, and as the thing that
      forces a deliberate second look if a `POST` route is ever added.

### 9. Step-up and `/whoami` — Sonnet / **Opus (security-critical)**

- [ ] `GET /whoami`: `{ active, held }` re-derived from
      `user_role_assignments`, plus the profile attributes that never belong
      in a token (avatar, preferences, display name). It is not redundant with
      the ID token — the privilege half overlaps, the rest does not, and it
      reflects grants changed server-side after the token was minted.
- [ ] Design profile inheritance for `/whoami` (a tenant-level profile
      overriding the global/default one) — raised in PR #103 review as an
      open question, not yet discussed. Once designed, add the e2e/BDD
      scenario also raised there: log a user into one tenant, then a second,
      and assert both the per-tenant and overall token claims plus
      `/whoami`'s tenant-scoped profile for each.
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
  Trigger: two identity engines live *at once*, a token shape or signing
  algorithm Cognito cannot produce, or an external RP that shouldn't be handed
  AWS-specific issuer details. A straight migration off Cognito is *not* a
  trigger — step 4a's discovery document makes that one published value
  changing. Doing this would also make that document spec-compliant, which it
  is not today.
- **No-code onboarding** — a self-service UI over the tenant/client/provider
  registration interface step 2 keeps narrow.
- **User profile surface** on `auth.<zone>`'s own tenant (avatars and the
  like), backing the profile half of `/whoami`.
- **Verification links as an alternative to codes.** Viable because we
  generate and store the code ourselves, so a link embedding it needs no
  Cognito hosted domain. A product call, not a blocker.
- **Dual ESM+CJS retrofit** for `auth-lambda` and `auth-ui`
  (`node-vlinder-auth#86`), and for `http-api-authorizer-lambda`
  (`node-http-api-authorizer#16`).
- **Mermaid validation in CI.** `markdownlint` does not parse Mermaid, so a
  diagram with a syntax error passes every check and then renders as an error
  box on GitHub — this has already happened once here (an HTML entity in a
  participant alias, and a semicolon in a note, both fatal to the parser).
  Add a `mermaid-cli` render step to `ci_lint_markdown.yml`; it needs
  `--puppeteerConfigFile` with `--no-sandbox` on GitHub runners.

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

- **2026-09-06** — Corrected the reasoning around Cognito's fixed issuer, and
  added step 4a. The docs had treated `iss` naming Cognito as a coupling
  defect that self-issuance would fix, and had claimed we mirror Cognito's
  JWKS at `auth.<zone>/.well-known/jwks.json`. Both were wrong: no mirror
  exists anywhere in the code, and the coupling is not inherent — it comes
  entirely from consumers learning the issuer at build time instead of from a
  published endpoint. Establishing that endpoint is required on security
  grounds regardless (a validator that trusts the token's own `iss` pins
  nothing), and it is separately what makes a future engine swap a one-value
  change. Self-issued tokens stay in the backlog, but for a narrower reason —
  issuer *ownership*, not portability — with correspondingly narrower
  triggers. The discovery document deliberately uses the standard
  `/.well-known/openid-configuration` path even though its `issuer` will not
  match its host until self-issuance, which strict OIDC libraries reject; the
  deviation is temporary, self-resolving, and documented where integrators
  will meet it. No code changed — step 4a is the resulting gap.

- **2026-09-09** — Closed out the prior plan (step 0). Full-suite
  verification passed (unit tests, e2e dry-run, lint, `tsc --noEmit` across
  all workspaces). Eyeballed `design_handoff_auth_chrome/`'s mockups against
  `auth-site`'s dev server: the chrome layer (split panel, card, colors,
  spacing, copy) matches the handoff spec exactly for sign-in, sign-up and
  forgot-password. The verify screen uses a single text input rather than the
  mockup's 6-digit box treatment — pre-existing `auth-ui` primitive, out of
  the chrome-only scope of that handoff, not a regression. Directory deleted.
  SonarQube baseline on `main` had one remaining finding
  (`typescript:S7781`, `AuthChrome.tsx:32`, prefer `replaceAll` over
  `replace`); fixed as part of this step so the baseline is now clean.

- **2026-09-09** — Privilege model rewritten to `verb:tenant-id:resource-glob`
  (step 1). New `shared/privilegeMatch.ts` — `parsePrivilege`,
  `matchesResourceGlob` (gitignore-style, recursive segment walk, not a single
  hand-rolled regex, specifically for the `**`-traversal boundary cases),
  `hasPrivilege`, `resolveGrantedTenant` — is TDD'd first with 37 cases
  covering the three equivalent tenant-irrelevant spellings, malformed grants,
  and traversal boundaries (`*` not crossing `/`, `**` crossing zero or more
  segments, regex metacharacters in a literal resource treated literally).
  `pre-token-generation/handler.ts` now emits a space-separated `scope` claim
  instead of comma-joined `permissions`. `admin-api/authz.ts`'s role-vs-scope
  intersection (`CallerContext.privileges` + `resolveAccessScope`'s
  `SCOPE_RANK`) is gone; `CallerContext` now carries only `scopes`, and
  `assertTenantAccess`/`callerHasPrivilege`/`resolveCallerTenantScope` match
  against the token's scopes alone. Every admin-api handler's
  `PRIVILEGE_FAMILY` string became a `{ verb, resource }` pair
  (`admin:users:read` → `{ verb: 'read', resource: 'admin/users' }`,
  `admin:roles:read` → `{ verb: 'read', resource: 'admin/roles' }`, tenant
  passed separately as the target tenant-id rather than embedded via an
  `:own`/`:*` suffix). `listUsers` now takes the tenant to query from the
  matched grant itself (`resolveGrantedTenant`) rather than a separate
  `tenantId` claim, so there is exactly one authoritative source instead of
  two that could disagree. All fixtures across `lambda-src` and `auth-site`,
  and the privilege tables/comments in `use-cases/README.md` and the three
  `admin/*.feature` files, updated to the new form. No Terraform-seeded role
  catalog exists in this repo to update — that data lives in
  `terraform-modules`, out of this repo's scope.

  Opus review (required for this security-critical step) caught a real gap
  the first pass missed: `RoleDefinition.tenantScope` was read from DynamoDB
  but never used, so a `tenant`-scoped role's catalog privileges had nowhere
  to pick up the caller's actual tenant — the fixtures I'd written happened
  to bake a matching tenant-id directly into the catalog entry, which masked
  it. Fixed by having `resolvePrivilegesForUser` bind a `tenant`-scoped
  role's privileges to the caller's resolved tenant at resolution time
  (`shared/privileges.ts`'s new `bindRolePrivileges`), so the catalog itself
  stores reusable, tenant-irrelevant privilege templates and only becomes
  tenant-concrete at token issuance; `global`-scoped roles pass through
  unchanged. The review also caught `resolveGrantedTenant` collapsing several
  tenant-scoped grants down to the last one seen instead of collecting all of
  them (a caller holding grants in two tenants would silently see only one in
  `listUsers`) — fixed to return `tenantIds: string[]`, with `listUsers`
  querying each and unioning the results. Also addressed: unmemoized
  per-backtrack regex compilation in `matchesResourceGlob` (precomputed once
  per call instead), and five handlers each redeclaring an identical
  `{ verb, resource }` literal (consolidated into `admin-api/privileges.ts`).
  Not addressed, deliberately: the claim-rename (`permissions` → `scope`)
  creating a deployment-window lockout for already-issued tokens — moot per
  this plan's "Current state" (nothing is deployed, no installed base).

  A second Opus review pass on the fixes confirmed both bugs resolved and
  caught one more: `matchesResourceGlob`'s recursive `**` walk had no
  memoization, making it exponential in the number of non-adjacent `**`
  segments crossed with the resource's segment length (empirically ~24s at
  10 non-adjacent `**`s, unbounded beyond that). Not reachable through
  today's call sites (fixed 2-segment `admin/users`/`admin/roles` resources),
  but `privilegeMatch.ts` is shared infrastructure for general
  `verb:tenant:resource-glob` matching that runs on every admin-api
  authorization check, so a future deeper resource hierarchy or a typo'd
  catalog entry with several `**`s would turn this into a CPU-exhaustion /
  Lambda-timeout DoS on the authorization hot path. Fixed with memoization
  on `(patternIndex, resourceIndex)`, collapsing it to
  O(patternSegments × resourceSegments); regression test asserts a
  12-non-adjacent-`**` pattern resolves in under 500ms.

  A third pass re-flagged the now-fixed `**` finding against a stale diff
  (confirmed by direct inspection that the memoization commit was already
  on the branch) and surfaced two real, lower-severity items, both fixed:
  `resolveCallerTenantScope`/`assertTenantAccess` redeclared the inline
  `{ verb, resource }` shape instead of reusing `RequiredPrivilege` (now
  `TenantAgnosticPrivilege = Omit<RequiredPrivilege, 'tenantId'>`); and
  `bindRolePrivileges` binds every privilege on a `tenant`-scoped role with
  no way for one to opt out and stay tenant-agnostic, which is fine given
  `tenantScope` is a per-role property in the architecture spec but was
  undocumented as a constraint — now documented, with the escape hatch
  (split a mixed role into a `tenant`-scoped and a `global`-scoped entry,
  assigned together) spelled out in the docstring.

  User review (not the Opus pass, a direct read of the diff) caught a real
  design smell the Opus passes missed: `listUsers` had a test explicitly
  demonstrating that a mismatched `caller.tenantId` claim was silently
  discarded in favor of whatever tenant the scope named, rather than either
  being consulted or erroring on disagreement. Investigating why turned up
  that `CallerContext.tenantId` was already dead everywhere else --
  `getUser`/`assignRole`/`revokeRole`/`setUserEnabled` derive their target
  tenant from the resource being acted on, never from this claim, and
  `listUsers`'s route takes no tenant parameter of its own to check it
  against. It only ever looked like a second, competing input. Removed
  `tenantId` from `CallerContext` and `extractCallerContext` entirely (the
  `scope` claim, which already carries the tenant per privilege, is now the
  only field read into the caller's authorization context), so there is
  exactly one source of truth and nothing left to silently prefer over
  another. The `tenantId` claim itself is untouched at the token level --
  other consumers (e.g. the SPA, for display) may still read it; only the
  admin API's own authorization stopped treating it as an input.

  A fourth Opus pass, prompted by the fix above, found the core matcher
  logic solid (as expected, having already been through three review
  rounds) but caught documentation drift this PR's own commits should have
  caught: this repo's top-level `README.md` still documented the retired
  `permissions` claim and `<family>:own`/`<family>:*` convention as current,
  contradicting `doc/architecture.md` and the shipped code; `doc/use-cases/README.md`'s
  Layout table still described `access-scope.feature` in the old `own`/`*`
  terms a few lines above its own already-updated section. Both fixed. Also
  fixed: `resolveGrantedTenant` redeclared `{ verb, resource }` inline
  instead of reusing the shared privilege-check shape (moved
  `TenantAgnosticPrivilege` into `privilegeMatch.ts` itself, where
  `RequiredPrivilege` lives, so `admin-api/authz.ts` re-exports rather than
  redeclares it).

  The same pass also surfaced a genuine cross-repo break: `terraform-modules`'
  `vlinder_auth` module still seeds its default `admin` role (and both
  README examples, and `rbac.tftest.hcl`'s fixtures) in the old
  `admin:users:read:own` form, which the new `parsePrivilege` rejects
  outright -- every deployment using the default role catalog would get a
  total admin lockout (every admin API call 403s) the moment it picks up
  this lambda-src version. Fixed directly in `terraform-modules` on
  `feature/cognito-auth-module` (the existing draft PR #133 already
  accumulating the unmerged `vlinder_auth` module -- not yet on `main`, so
  no live deployment was ever actually at risk): default catalog and both
  README examples now seed tenant-scoped roles with tenant-irrelevant
  privilege templates and global-scoped roles with the explicit
  `verb:*:resource-glob` form, matching the binding behavior
  `bindRolePrivileges` implements on this side; `rbac.tftest.hcl` updated to
  match and reverified (`terraform test`, 57/57 passing).

  Follow-on design correction, requested directly: a user can be logged in
  on more than one tenant at once, and a tenant-wildcard scope must not
  reach beyond the tenants the caller is actually authenticated against
  (a tenant the caller never authenticated to may sit behind a different
  identity provider entirely). This closes a real gap in the design above,
  not an implementation bug in it. Replaced the singular `tenantId` claim
  with a space-separated `tenants` claim; `hasPrivilege`/`resolveGrantedTenant`
  now take the caller's authenticated-tenants set as a required third
  argument and cap every tenant-wildcard match to it -- a concrete grant
  naming a tenant outside that set is rejected too, as a defensive backstop.
  `GrantedTenantScope`'s `'global'` variant is gone: a wildcard now always
  resolves to a concrete, capped tenant-ID list, so `listUsers`' unfiltered
  `ScanCommand` branch (previously reachable by any super-admin-style grant,
  regardless of which tenants they'd actually authenticated to) is deleted
  entirely -- there is no code path left that lists across the whole table.
  Lifted the "v1 assumes a user is active in exactly one tenant" restriction
  in `resolveUserRoleAssignments`/`resolvePrivilegesForUser`: role
  assignments are now grouped and resolved per tenant rather than anchored
  to the first tenant seen, so a user's actual holdings across tenants are
  reflected instead of silently discarded. `CallerContext.tenants` is
  distinct from the `tenantId` field removed earlier in this step -- that
  one was genuinely dead (nothing read it); this one is load-bearing, since
  it's what every wildcard match is capped against. Reflected in
  `terraform-modules`' `vlinder_auth` README (same PR #133).

  A fifth Opus pass on the multi-tenant correction caught a real,
  confirmed-live-in-Terraform cross-repo gap: `vlinder_auth`'s
  `admin_api_authorizer` still set `jwt_forward_claims = ["tenantId",
  "permissions", "scope"]`, forwarding two retired claim names and never
  forwarding `tenants` at all -- `extractCallerContext` would have silently
  read `caller.tenants` as always-empty in production, 403ing every
  tenant-scoped admin action with no error pointing at the cause. Fixed to
  `["tenants", "scope"]`; added a contract test asserting exactly those two
  claim names are forwarded (`admin_api.tftest.hcl`), which needed a new
  `jwt_forward_claims` output on `http_api_authorizer` since module
  encapsulation otherwise hides it. It also found three real correctness
  gaps in this repo, all fixed: `listUsers`' row-grouping keyed solely on
  `userId`, so a user with assignments in two of the caller's queried
  tenants had the second tenant's roles silently merged into the first
  tenant's entry, misattributing which tenant granted them -- now keyed on
  `(userId, tenantId)`. `getUser`/`assignRole`/`revokeRole`/`setUserEnabled`
  each anchored to an arbitrary single row (`rows[0]` or a `Limit: 1`
  query) when looking up a *target* user's tenant, silently dropping or
  misauthorizing against any other tenant that target held -- unreachable
  today (no admin-api action can create a target user with assignments in
  more than one tenant yet) but a live trap now that the data model
  formally supports it. Replaced with a shared
  `admin-api/targetTenant.ts#loadTargetUsersSoleTenant`, which throws
  loudly on a multi-tenant target instead of silently picking one --
  consolidating four copies of the same lookup into one as a side effect.
  Also fixed: `resolvePrivilegesForUser` resolved each tenant's role
  definitions in a sequential loop instead of one `Promise.all` across
  every tenant, adding avoidable per-tenant latency inside the
  timeout-sensitive Cognito pre-token-generation trigger.

- **2026-09-11** — Step 2 (client registry and tenancy resolution). New
  `shared/tenants.ts` functions, TDD'd: `resolveTenantIdForClient` (the
  `client_id → tenant_id` lookup, via a new `clientId-index` GSI on the
  `tenants` table; an absent `client_id` resolves to the auth application's
  own reserved tenant, `"auth"`, rather than falling back to some default --
  `auth.<zone>` reached with no `client_id`, e.g. the admin panel, belongs
  there) and `resolveIdentityProviderForDomain` (the `(email_domain,
  tenant_id) → identity provider` lookup, a direct `GetItem` on
  `(tenantId, "DOMAIN#<domain>")` since the tenant is already known by the
  time this runs -- no second GSI needed). Both throw/return `undefined`
  rather than guess: an unrecognized `client_id` throws `UnknownClientError`
  instead of silently mapping to a tenant it was never granted; a domain
  with no pin in the resolved tenant returns `undefined`, meaning the
  tenant's defaults apply, not that some other tenant's pin should.

  Wired live into `/auth/identify`, the one endpoint of the two the plan
  names that already exists (`/authorize` is step 6, unbuilt): it now
  accepts an optional `client_id`, resolves the tenant, and resolves the
  identifier's email domain against that tenant's pins, returning
  `method: 'redirect'` with a same-origin `location` (`/federation?
  provider=<id>&action=start`) when one is pinned -- matching the
  `method: 'redirect'`/`location` contract `ui-auth`'s `SignInFlow` and
  `auth-site` already expected (an earlier draft of this invented a
  competing `'federated'`/`provider` shape before noticing the frontend
  already had one). Actually driving a federated sign-in (the
  `/federation` endpoint itself, and the redirect/callback handshake)
  stays step 11's job -- this only determines that a redirect is due and
  where to, per the existing "federation resolution lands in a later
  increment" comment in `identify.ts`, which described the redirect, not
  this determination. Since no tenant has any domain pinned by default,
  existing sign-in behavior (`method: 'password'`) is unchanged wherever
  nothing new is
  configured.

  `terraform-modules`' `vlinder_auth` module (same feature branch, PR #133 --
  confirmed with rlc it stays unmerged until this whole line of work is
  done, so this landed as a further commit on it rather than a new PR):
  the `tenants` table gained a range key (`sk`) so it can hold more than one
  record per tenant -- `"PROFILE"` (the existing tenant record, unchanged
  shape), `"CLIENT#<clientId>"` (the new registry entry, indexed by the new
  `clientId-index` GSI), `"DOMAIN#<domain>"` (the new identity-provider pin,
  looked up directly, no GSI). `clients` enties gained `tenant_id` (required,
  and validated against `tenants`' keys, in `"multi"` mode); `tenants`
  entries gained `identity_providers` (domain → provider id map). The auth
  site's own Cognito client is now registered under the reserved `"auth"`
  tenant, which is merged into `effective_tenants` unconditionally -- even
  `"single"` mode now seeds two tenant records (`"default"` and `"auth"`),
  matching `architecture.md`'s "even single-tenant deployments have at least
  two tenants" line, which the code hadn't caught up with before this step.
  `auth_api`'s IAM role and environment gained exactly the two permissions
  this needs (`GetItem` on the table, `Query` on `clientId-index`) and two
  env vars (`TENANTS_TABLE_NAME`, `AUTH_APP_TENANT_ID`).

  Not done, deliberately: no admin-facing registration API for clients or
  domain pins -- registration today is Terraform-variable-driven, same
  convention as the existing `tenants`/`roles` seeding, which is itself the
  "narrow interface" the plan asked to keep clear for later no-code
  onboarding (swapping the seeding mechanism for a live API later doesn't
  change what reads the table). No actual federation handshake -- that's
  step 11. No threading of the resolved `tenantId`/`provider` past the
  identify-session into `/auth/password` or `/auth/signup` yet -- today's
  single-tenant-per-signup flow (`post-confirmation`'s domain-based
  `resolveTenantForNewUser`) is untouched and still what assigns a new
  user's tenant; connecting the two is part of the RP handoff work in step
  6, which is also what's meant to extend the identify-session JWS further.

- **2026-09-11** — Step 3 (stop stripping `/api/v1`). In `terraform-modules`
  (same feature branch as step 2, PR #133): every route in
  `local.admin_api_routes` and `local.auth_api_routes` now carries the
  `/api/v1` prefix directly in its `route_key` (e.g. `GET /api/v1/users`,
  `POST /api/v1/auth/identify`). `aws_cloudfront_function.auth_api_rewrite` is
  deleted outright -- its template file too -- rather than kept as a stub:
  the `/api/v1/auth*` behavior's `function_association` is removed
  entirely, since those routes are public and the origin's `custom_header`
  override (which unconditionally overwrites any viewer-supplied
  `X-Origin-Verify`, regardless of what a CloudFront Function does or
  doesn't strip first) was always the actual enforcement point, not the
  function's own `delete request.headers[...]` line -- that was
  redundant defense-in-depth, confirmed by reading how CloudFront origin
  `custom_header` actually behaves, not assumed. `admin_api_rewrite.js`
  loses only its `request.uri = request.uri.replace(/^\/api\/v1/, '')`
  line; the cookie-to-Authorization lift and the `X-Origin-Verify` strip
  it also does are untouched, since neither is what this step is about.
  Added a new contract test (`admin_panel.tftest.hcl`) asserting
  `admin_api_rewrite`'s code contains no `request.uri =` assignment
  (`spa_viewer_request` is deliberately excluded -- it legitimately
  rewrites the URI for SPA client-side-routing fallback, an unrelated
  concern). Updated every existing test asserting on the old unprefixed
  route-key literals.

  In `node-vlinder-auth`: `auth-api/handler.ts` and `admin-api/handler.ts`
  had every `case` literal in their `routeKey` switches updated to match
  (API Gateway's `route_key` is exactly what `event.routeKey` carries at
  runtime, so a mismatch here would 404 every route). The SPA
  (`auth-site/main.tsx`, `admin-main.ts`) needed **no changes at all**: it
  was already sending `/api/v1/...` paths (per `architecture.md`'s
  already-written "fixed infrastructure constant, never config" framing)
  -- the CloudFront function was the only thing rewriting them down to the
  unprefixed form the API Gateway routes used to expect, so removing it
  and prefixing the routes to match is the whole fix, symmetric by
  design. `doc/architecture.md` and `doc/vendor-neutral-auth.md` already
  described this target end-state (written ahead of the code, evidently
  for this exact step) and needed no changes.

- **2026-09-11** — Step 4 (edge response headers). `terraform-modules` (same
  feature branch, PR #133): a new `aws_cloudfront_response_headers_policy`
  attached to the auth site's default cache behavior only -- the login/admin
  SPA, not the `/api/v1/*`/`/api/v1/auth*` API behaviors, which serve JSON
  rather than framable HTML. Sets `X-Frame-Options: DENY` and
  `Content-Security-Policy: frame-ancestors 'none'`, per `architecture.md`'s
  already-written "Edge response headers" section. Also added
  `Strict-Transport-Security` (2-year max-age, subdomains included) beyond
  the plan's literal two headers, since Checkov's `CKV_AWS_259` flagged its
  absence and the distribution already forces HTTPS on every behavior
  anyway; left unpreloaded and skipped the check's `preload=true` mandate
  with a documented reason -- HSTS preload registration is a deliberate,
  hard-to-reverse choice for the caller's own domain that this reusable
  module shouldn't make on every consumer's behalf. Removed the
  now-incorrect `CKV2_AWS_32` skip on the distribution itself (it now
  genuinely has a response-headers policy). New contract tests assert the
  policy is attached and both required headers are set with `override =
  true`. Filed the tracking issue
  ([workspace-vlinder-auth#5](https://github.com/vln-devsecops/workspace-vlinder-auth/issues/5))
  for whether the API behaviors need their own (different) header posture --
  out of scope here since clickjacking isn't the concern for a JSON API.

- **2026-09-11** — Step 4a (publish the OIDC discovery document,
  **security-critical**). Entirely in `terraform-modules`
  (`feature/cognito-auth-module`, this time as its own PR against that
  branch rather than a direct push -- see below): a new
  `local_file.auth_site_discovery_document`, written into the same S3
  origin as `config.json` and by the same mechanism, at
  `.well-known/openid-configuration`. `issuer`/`jwks_uri`
  come straight from `local.admin_api_issuer_url` -- the exact value the
  admin API's own JWT authorizer already trusts, so there's one source of
  truth for "what issues our tokens", not a second copy that could drift.
  `authorization_endpoint`/`token_endpoint`/`end_session_endpoint` are
  published now even though no handler answers `/api/v1/auth/{authorize,
  token,logout}` yet (step 6) -- publishing the URL doesn't require the
  endpoint to exist, same precedent as `/federation` in step 2's `identify`
  work. `spa_viewer_request.js` gained an early-exit for `/.well-known/*` so
  it isn't silently rewritten to `index.html` with a `200`. Added a
  `cors_config` to the existing default-behavior response-headers policy
  (CORS-open, since a resource server on another origin must be able to
  fetch the document) -- necessarily behavior-wide, not path-scoped, since a
  CloudFront response-headers policy applies per-behavior; harmless here
  since the whole default behavior is already public unauthenticated GETs.
  `output.issuer_url` now reuses `local.admin_api_issuer_url` instead of
  duplicating the expression, and both its description and the README are
  rewritten to say plainly that it's convenience for wiring a JWT authorizer
  in the same apply, not the integration contract -- the discovery document
  is. New terraform contract tests cover the file path, issuer/jwks_uri
  derivation, the three endpoint URLs, the deploy step's redeploy-on-change
  trigger, the `spa_viewer_request` exemption, and the CORS config. New e2e
  scenario (`oidc-discovery.feature`) signs in for a real access token,
  decodes its `iss` (no signature verification -- that's not this test's
  job), fetches the live discovery document, and asserts the two agree,
  rather than asserting either against a hardcoded constant.

  Also: per rlc's direction, this is the first terraform-modules change in
  this line of work done as its own branch + PR *against*
  `feature/cognito-auth-module` (PR #281) rather than a direct push onto it
  -- the prior direct-push commit for step 4 was retroactively moved onto
  its own branch (PR #280) and `feature/cognito-auth-module` force-pushed
  back to drop it, so every change onto that branch from here on has its
  own reviewable PR. `feature/cognito-auth-module` (PR #133) itself stays
  open/unmerged until this whole line of work is done, per rlc.

- **2026-09-12** — Step 5 (split ID and access token claims,
  **security-critical**). `resolvePrivilegesForUser`'s single privilege set
  became two: `idTokenPrivileges` (held-plus-active -- every role the user
  holds, `default` and `elevated` alike) and `accessTokenPrivileges`
  (active-only -- just `default`-activation roles, exactly today's
  pre-split behavior). Both are derived from **one** batched
  `getRoleDefinition` fetch over every held role, not two -- fetching the
  full superset once and filtering the access-token subset from it, since
  doubling DynamoDB round-trips inside the synchronous, timeout-sensitive
  Cognito pre-token-generation trigger would undo the exact batching
  `resolvePrivilegesForUser` already existed to provide. `tenants` is
  computed once and stays identical on both tokens -- it's an
  authentication-scope concept, not an activation one, so it was never in
  scope for this split. The optional pre-token-generation hook (external,
  vendored, contract predates the split) now receives the access-token
  (active-only) set under its existing `privileges` key -- the narrower,
  more conservative choice for a hook reacting to "what can this session do
  right now."

  Implemented by a clean-context agent (no memory of this session) from a
  self-contained brief; I reviewed the diff directly, independently
  re-ran the full verification suite myself rather than trusting its
  report, then handled `plan.md` and the PR. This is the first step done
  under that split going forward, per rlc.

- **2026-09-12** — Step 6 (RP handoff: `/authorize` + `/token`,
  **security-critical**). Resolved one real design gap before implementing:
  the plan's illustrative one-time-token payload
  (`jwe({user, redirect_uri, code_challenge, timestamp})`) has no token
  material, but `/token` must return real Cognito tokens with no second
  Cognito call, since this Lambda is stateless. Confirmed directly with rlc:
  the one-time token's actual payload also carries the `AuthenticationResult`
  obtained back at `/password` (access/id/refresh token + expiry),
  end-to-end encrypted (`dir`/A256GCM JWE, `oneTimeToken.ts`) so it's opaque
  to the browser and the RP's front-end, which only relay it.

  New: `oneTimeToken.ts` (mint/verify, 32-byte key requirement enforced
  loudly rather than left to a cryptic `jose` error), `pkce.ts`
  (`verifyCodeChallenge`, S256 only -- plain PKCE deliberately unsupported),
  `handlers/authorize.ts` (validates client→tenant, then `redirect_uri`
  against that client's registered allowlist by exact-string match --
  never redirects on any validation failure, only on success, to avoid
  open-redirect risk from a partially-OAuth-spec-compliant error-redirect
  path), `handlers/token.ts` (decrypts the one-time token, checks PKCE,
  hands back the embedded tokens -- `InvalidOneTimeTokenError` and
  `PkceMismatchError` stay distinct internally but collapse to one generic
  400 at the HTTP layer, so a caller can't distinguish "token invalid" from
  "PKCE mismatch"). `shared/tenants.ts` gained `resolveClientRedirectUris`
  (a second `clientId-index` query, deliberately not merged into
  `resolveTenantIdForClient` -- that function's shape is depended on
  elsewhere, and `/authorize` isn't the timeout-sensitive pre-token-
  generation trigger, so the extra round trip costs nothing that matters).

  `identify.ts` now threads optional `redirectUri`/`codeChallenge`/`state`
  into the identify-session JWS when present, unchanged otherwise.
  `password.ts` checks for `redirectUri`+`codeChallenge` on the identify-
  session claims after a successful Cognito auth: if present, mints the
  one-time token and returns a new `redirect` result instead of tokens in
  the body; if absent (today's existing direct-login case, e.g. the admin
  panel), completely unchanged. `authMethod` is recorded as a **separate**
  cookie (`vln_auth_method`, `AUTH_METHOD_COOKIE`) rather than folded into
  the existing AS session cookie -- confirmed by reading
  `terraform-modules`' `admin_api_rewrite.js`, which lifts that cookie's
  value verbatim into a `Bearer` header, so its format can't change without
  breaking that already-shipped mechanism. Always `'local'` for now --
  there is no federated-login completion path yet (step 11).

  `terraform-modules` (new PR #282 against `feature/cognito-auth-module`,
  not #133 or #281 -- every change onto that branch now gets its own PR per
  rlc's standing direction): the `CLIENT#` registry item gained
  `redirectUris`, sourced from the same `callback_urls` a client's own
  Cognito app client already declares (no second, driftable allowlist), and
  a new `auth_one_time_token_key` secret, sized to exactly 32 raw bytes
  (`--password-length 32 --exclude-punctuation`) so `oneTimeToken.ts` needs
  no decoding step.

  Implemented by a clean-context agent from a thorough, decision-annotated
  brief (I resolved every design ambiguity myself first, including the
  one-time-token/Cognito-call question above, before writing it, so the
  agent implemented rather than designed); I reviewed the full diff and
  independently re-ran verification myself before proceeding. The
  terraform-modules registry/secret extension I wrote directly, matching
  the exact contracts the agent's lambda-src code expects.

  An Opus review pass on the resulting PR caught a real bug my own review
  missed: `/authorize` validates `redirect_uri` against the client's
  registered allowlist, but nothing stopped a caller from reaching
  `/identify` **directly**, skipping `/authorize` entirely, and embedding
  an arbitrary unregistered `redirect_uri` straight into the signed
  identify-session -- `/password` would then 302 the browser to it
  unchecked once login succeeded, an open redirect (and token leak, since
  the one-time token rides in that URL) from the trusted auth domain. Fixed
  by centralizing the allowlist check as `shared/tenants.ts`'s new
  `assertRegisteredRedirectUri` and calling it from **both** `/authorize`
  and `/identify` -- the same defense-in-depth posture `admin-api/authz.ts`
  already uses elsewhere in this codebase (each handler independently
  re-derives and re-checks, never trusting that an earlier step already
  checked). `/identify` also now requires `client_id` and `code_challenge`
  whenever a `redirect_uri` is present, rather than silently proceeding
  with a partial, unverifiable RP-handoff context. Also caught: `/authorize`
  never rejected an empty `code_challenge`, which would previously sail
  through every check and only surface later as a confusing silent
  fallback to the direct-login response at `/password` -- fixed with an
  explicit required-fields check before any DB round-trip. A pre-existing,
  unrelated test-flakiness bug was also found and fixed while re-verifying
  (`token.test.ts`'s tamper test flipped the last base64url character,
  which can land on padding bits that don't change the decoded bytes --
  `oneTimeToken.test.ts`'s identical test already avoided this correctly;
  `token.test.ts`'s copy hadn't).

  A second Opus pass on the fix caught three more: the new
  `InvalidAuthorizeRequestError` (added by the fix above) was never wired
  into `errorResponse()`, so a missing required field at `/authorize` fell
  through to an unhandled 500 instead of the intended 400 -- added. The
  RP-handoff redirect built its final URL by string-concatenating
  `` `${redirectUri}?token=...` ``, which corrupts a registered
  `redirect_uri` that already carries its own query string (e.g.
  `?tenant=acme`) into one malformed string instead of adding a distinct
  `token` param -- rebuilt via the `URL`/`URLSearchParams` API instead.
  `/authorize`'s two independent DynamoDB lookups (client→tenant,
  redirect_uri allowlist) were awaited sequentially for no reason -- neither
  depends on the other's result -- switched to `Promise.all`.
