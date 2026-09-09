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

### 4a. Publish the OIDC discovery document — Sonnet / **Opus (security-critical)**

The published `issuer`/`jwks_uri` are what every resource server pins against.
Nothing exists today: `config.json` carries no issuer, and the Terraform
`issuer_url` output is deploy-time wiring, not a runtime contract — with only
that, changing the signing engine means every relying party re-applies in
lockstep. Prerequisite for steps 5, 6 and 8, which all assume consumers can
discover what to trust. Reasoning in [`rationale.md`](./rationale.md) ("The
expected issuer is configuration, not a constant").

- [ ] Terraform writes `.well-known/openid-configuration` into the auth-site
      S3 origin via `local_file`, exactly as it already does `config.json` —
      every value is a per-deployment constant known at apply time.
- [ ] Populate `issuer` and `jwks_uri` from the existing
      `local.admin_api_issuer_url` (Cognito's real endpoints — **no mirror**,
      so key rotation can never be served stale), plus the first-party
      `authorization_endpoint`, `token_endpoint` and `end_session_endpoint`.
- [ ] Exempt `/.well-known/*` from `spa_viewer_request`. That path is
      extensionless by specification, so the SPA fallback currently captures
      it and returns `index.html` with a `200` — a failure that looks like
      success to every consumer. Contract-test the exemption specifically.
- [ ] Serve it public, cacheable and CORS-open (`Access-Control-Allow-Origin:
      *`); it carries nothing secret and browser-side consumers must reach it.
- [ ] Contract-test that `issuer` is derived from this module's own user pool
      and that `jwks_uri` resolves, mirroring
      `identity.tftest.hcl`'s existing `issuer_url` assertions.
- [ ] Cover it in the e2e suite: fetch the document against a real deployment
      and validate a live access token's `iss` against the value it publishes,
      rather than against a constant in the test.
- [ ] Update the `vlinder_auth` README: `issuer_url` is convenience for wiring
      a JWT authorizer in the same apply, **not** the integration contract.
- [ ] Document the spec deviation where integrators will hit it — the
      document's `issuer` will not match its host until self-issuance, so
      strict OIDC libraries reject it. Already written up in
      [`vendor-neutral-auth.md`](./vendor-neutral-auth.md); make sure the
      module README says it too.

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
