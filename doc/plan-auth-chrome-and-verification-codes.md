# Plan: app-owned verification codes + AuthChrome handoff

**Current step:** 3 (not yet started)

## Context

Two bundled efforts, sequenced together because the second's BDD coverage
depends on the first:

1. **Stop relying on Cognito to generate/send signup and password-reset
   codes.** Our own `auth-api` lambda already owns the whole `/api/v1/auth/*`
   surface; it should generate the code itself, store it, send it via SES,
   and use Cognito's admin API to declare the user verified once the code
   checks out. Cognito never needs to know the code. This was chosen over
   alternatives (intercepting Cognito's own email via SES inbound receiving,
   or trying to read Cognito's internal code via CustomMessage) because:

   - Cognito's `CustomMessage` trigger only ever receives the `{####}`
     placeholder, never the real code (confirmed via AWS docs) — no Lambda
     trigger can observe Cognito's own generated code.

   - `AdminCreateUser` + `AdminSetUserPassword(Permanent: true)` (the pattern
     `e2e/support/world.ts`'s `createConfirmedTestUser` already uses for test
     fixtures) jumps straight to `CONFIRMED` *without* firing
     `PostConfirmation`, and calling `AdminConfirmSignUp` afterward fails
     ("already confirmed") — confirmed via AWS docs + a corroborating GitHub
     issue. Not a viable basis for the real signup flow.

   - The only way to stop Cognito's own auto-email at signup is the
     `PreSignUp` trigger's `autoConfirmUser=true` (AWS's own docs have an
     "auto-confirm and auto-verify all users" example for exactly this). That
     flag confirms the account **instantly**, so the app must gate login
     itself until our own code is actually verified — chosen over the
     alternative (stay `UNCONFIRMED`, call `AdminConfirmSignUp` only once our
     code checks out) because that alternative still can't suppress Cognito's
     own auto-email, defeating the point.

   - Confirmed via the same AWS docs: `PreSignUp`'s `autoConfirmUser`/
     `autoVerifyEmail` response fields are *ignored* when the trigger fires
     from `AdminCreateUser` — so existing test fixtures
     (`createConfirmedTestUser`, used by `signin.feature`/`admin-panel.feature`/
     `session.feature`) are unaffected by this change.
2. **Implement Claude Design's `AuthChrome` handoff** (themeable brand-panel
   chrome around the existing unstyled auth forms), with TDD (Vitest/RTL,
   matching `packages/ui-auth`'s existing colocated-test convention) and BDD
   (Cucumber/Playwright, matching `e2e/`'s existing one-file-per-flow
   convention). Once (1) lands, e2e can drive the **real** happy path for
   signup-confirmation and password-reset (reading the real code straight out
   of the new DynamoDB table — same "test setup reaches past the app layer"
   precedent already used for the role-assignments table), not just
   negative-path coverage.

## Process

This doc is the source of truth for progress, not conversation memory —
sessions implementing this plan may be far apart (new Claude sessions, token
limits). Each session should pick up **one numbered step**, implement it,
update this doc (tick its checkboxes, append a dated entry to the Progress
Log below, bump "Current step"), and stop for review rather than chaining
into the next step unannounced.

**Always check CI findings on the PR before calling a step done** — passing
tests locally isn't the same as a clean pipeline. PR #69 (the post-review
doc fixes) shipped clean locally but failed `markdownlint` and SonarQube in
CI purely because of files vendored into the repo for this plan
(`design_handoff_auth_chrome/`'s own README and `.dc.html` mockups) — a
class of failure that's invisible until you actually look at `gh pr checks`
/ the SonarQube annotations.

**Clean SAST is an exit criterion for this whole plan, not a nice-to-have.**
Step 1 front-loads fixing every pre-existing SonarQube finding that no later
step would otherwise touch; Steps 4, 5, and 9 carry reminders to clear the
findings that sit in files they're rewriting anyway; Step 11 checks the
result. Don't let a "PR-scan blocked" state linger past the session that
introduced it — either fix it in that same session or leave a clear note in
the Progress Log below about why it's still open.

## Steps

### Step 0 — This doc

- [x] Commit this file, open a PR for review. No code changes.

### Step 1 — Fix pre-existing SAST findings on code this plan won't otherwise touch

The baseline SonarQube scan (`main` @ `5686e0a`, this branch's merge-base) carries
30 pre-existing findings (10 MAJOR / 20 MINOR). Steps 4, 5, and 9 below rewrite
`auth-api/handler.ts`, `esbuild.config.mjs`, and `auth-site/main.tsx` heavily
enough that 16 of the 30 get cleared incidentally by those rewrites — no
separate action needed there, just don't reintroduce the same patterns (each
of those steps has a reminder note). The other 14 sit in files this plan
never otherwise touches, so nothing clears them unless it's done explicitly,
here, first — fixing them now (rather than leaving them for whichever step
happens to next touch the file, which for several of these is "never") is
what "clean SAST" as an exit criterion (Step 11) depends on.

- [x] `e2e/support/world.ts:126` / `e2e/steps/signup.steps.ts:8`
      (`typescript:S2245`, MAJOR × 2) — `Math.random()` used to build unique
      per-scenario test emails. Swap both call sites to `crypto.randomUUID()`
      (or `randomBytes`); test-data uniqueness has no reason to use a PRNG
      SonarQube flags as cryptographically unsafe.

- [x] `packages/auth-site/admin/index.html:11` (`Web:InputWithoutLabelCheck`,
      MAJOR) — associate the input with a `<label for>` or `aria-label`.

- [x] `packages/auth-site/src/admin-main.ts:71` (`typescript:S7785`, MAJOR) —
      replace the promise chain with a top-level `await`.

- [x] `packages/ui-auth/src/VerifyEmailNotice.tsx` — `:25`
      (`typescript:S9011`, MAJOR, missing `type="button"`/`type="submit"`),
      `:28` (`typescript:S6819`, MAJOR, `role="status"` → `<output>`), `:10`
      (`typescript:S6759`, MINOR, mark props `Readonly<...>`). Neither Step 8
      nor Step 9 rewrites this component's internals — `AuthChrome` only
      wraps it from the outside — so fix it directly, here.

- [x] `packages/ui-auth/src/ConfirmSignUpForm.tsx:15`,
      `ForgotPasswordForm.tsx:19`, `SignInButton.tsx:12`, `SignInFlow.tsx:29`,
      `SignUpForm.tsx:50` (`typescript:S6759`, MINOR × 5) — same "mark props
      read-only" fix across the rest of the untouched form components.

- [x] `packages/auth-site/vite.config.ts:2`, `vitest.config.ts:2`
      (`typescript:S7772`, MINOR × 2) — `import path from 'path'` →
      `'node:path'`.

- [x] Verify: re-run the PR scan (`gh pr checks`) and confirm its "Removed"
      column accounts for all 14 of these, with "Added" at 0.

### Step 2 — Fix the session-signing-key secret-resolution gap

`packages/lambda-src/src/auth-api/handler.ts` reads
`process.env.SESSION_SIGNING_KEY` directly, but Terraform only ever sets
`SESSION_SIGNING_KEY_SECRET_ID` (the Secrets Manager ARN) — nothing resolves
the ARN to a value anywhere in the codebase. A real deployment would fail on
its first auth request. Small and isolated; land it alone before the bigger
changes that depend on the same "resolve a secret" capability.

- [x] Add `@aws-sdk/client-secrets-manager` to `packages/lambda-src/package.json`
      dependencies — not currently installed (only the Cognito/DynamoDB
      clients + `jose` are).

- [x] Add `packages/lambda-src/src/shared/secrets.ts`: `getSecret(secretId)`
      via `@aws-sdk/client-secrets-manager`'s `GetSecretValueCommand`, cached
      in a module-level map (populated on cold start, reused across warm
      invocations — standard Lambda pattern).

- [x] TDD first: `shared/secrets.test.ts` (cache hit avoids a second SDK
      call; propagates SDK errors).

- [x] Update `auth-api/handler.ts`: resolve `signingKey` via
      `getSecret(requireEnv('SESSION_SIGNING_KEY_SECRET_ID'))` instead of
      `requireEnv('SESSION_SIGNING_KEY')`. Update `handler.test.ts`'s env-var
      setup accordingly.

- [x] No Terraform change needed — `secretsmanager:GetSecretValue` on the
      right ARN is already granted to `auth_api`'s IAM role.

### Step 3 — Verification-code + email primitives (lambda-src)

- [ ] New `shared/verificationCodes.ts` (DI'd params, matching
      `shared/roleAssignments.ts`'s style):

      - `generateCode()` — 6-digit, `crypto.randomInt`.
      - `getOrCreateCode(email, purpose, ddbDocClient, tableName, ttlSeconds)`
        — **idempotent while valid**: if an unexpired row already exists for
        `(email, purpose)`, return its existing code unchanged (a resend must
        not invalidate a code the user is mid-typing); only generates+stores
        a new one when the row is missing or expired.

      - `verifyCode(email, purpose, submittedCode, ddbDocClient, tableName, maxAttempts)`
        — atomic attempts-increment (`ConditionExpression` capping at
        `maxAttempts`); deletes the row on success or on exhausting attempts;
        treats an expired row as not-found.

- [ ] Add `@aws-sdk/client-sesv2` to `packages/lambda-src/package.json`
      dependencies — not currently installed.

- [ ] New `shared/email.ts`: `sendVerificationCode(...)` via
      `SESv2Client`/`SendEmailCommand` (DI'd `sesClient`).

- [ ] TDD first: `shared/verificationCodes.test.ts` covering — code format;
      `getOrCreateCode` returns the same code on a second call within TTL;
      returns a new code once expired; `verifyCode` success deletes the row;
      wrong code increments attempts without deleting; exhausting attempts
      locks out; expired row treated as not-found.

- [ ] Storage is **plaintext, not hashed** — deliberate, not an oversight, so
      e2e can read it directly the same way it already reads the
      role-assignments table (Step 10). Short-TTL, single-use (deleted on
      success), attempt-limited, same IAM/network boundary as every other
      security-sensitive row this app already stores in DynamoDB in
      plaintext. Flag before Step 6 if this tradeoff doesn't sit right — the
      alternative (HMAC-hashed) is a small change here but forecloses the
      real-happy-path e2e coverage in Step 10.

### Step 4 — Wire the primitives into the auth-api handlers

- [ ] `handlers/registration.ts`: `signUp()` unchanged (still creates the
      Cognito account via `SignUpCommand` — `PreSignUp`, Step 5, intercepts it
      to skip Cognito's native verification). Replace `confirmSignUp()` /
      `resendConfirmation()` — no more `ConfirmSignUpCommand` /
      `ResendConfirmationCodeCommand`; confirm validates the submitted code
      against `verification_codes` and deletes the row on success (the user
      is already Cognito-`CONFIRMED` from the moment of `SignUp`, thanks to
      auto-confirm); resend calls `getOrCreateCode` + re-sends.

- [ ] `handlers/recovery.ts`: replace `forgotPassword()` /
      `confirmForgotPassword()` — no more `ForgotPasswordCommand` /
      `ConfirmForgotPasswordCommand`. Request step: `AdminGetUser` first
      (respond identically whether or not the account exists, to avoid
      leaking which emails are registered — only actually call
      `getOrCreateCode`+send if it does); confirm step: validate the code,
      then `AdminSetUserPasswordCommand({ Permanent: true })` directly.

- [ ] `handlers/password.ts`: **new login gate.** Since `PreSignUp` (Step 5)
      auto-confirms every account instantly, Cognito's own
      `UserNotConfirmedException` (today's implicit login-blocker for a
      never-verified user) will never fire again. Before calling
      `AdminInitiateAuthCommand`, check for a pending `"signup"`-purpose row
      in `verification_codes` for the identified user; if one exists, reject
      with a "please verify your email" error (same shape as the other
      friendly auth errors here).

- [ ] Update `handler.ts`'s route glue (`POST /auth/signup` now also
      triggers the first code send).

- [ ] TDD first, following `handlers/recovery.test.ts`'s existing
      `aws-sdk-client-mock` + DI style: rewrite `handlers/registration.test.ts`
      / `handlers/recovery.test.ts` around the new table-backed logic; add a
      `handlers/password.test.ts` case for the pending-verification gate.

- [ ] This rewrite touches every route in `handler.ts`'s switch, which also
      clears 9 pre-existing SonarQube findings there: a duplicate
      `./handlers/identify` import (`typescript:S3863`, lines 3 & 14) and
      seven `body.x ?? ''` default-stringification hits (`typescript:S6551`).
      Don't reintroduce either pattern in the rewritten routes.

### Step 5 — New `pre-sign-up` Cognito trigger

- [ ] `packages/lambda-src/src/pre-sign-up/handler.ts` (mirror
      `post-confirmation`'s file layout): unconditionally sets
      `event.response.autoConfirmUser = true` and
      `event.response.autoVerifyEmail = true`.

- [ ] TDD first: `pre-sign-up/handler.test.ts` asserts both fields are always
      set true.

- [ ] Add an entry point to `packages/lambda-src/esbuild.config.mjs`'s
      `handlers` array (`{ in: 'src/pre-sign-up/handler.ts', out:
      'dist/pre-sign-up/handler' }`) — the array is hardcoded to today's 4
      handlers; without this the new handler never lands in `dist/` and
      Terraform's `archive_file` silently zips a package without it. While
      in this file: fix its 3 pre-existing `javascript:S7772` findings
      (`fs`/`url`/`path` → the `node:`-prefixed imports, lines 18-20).

### Step 6 — Terraform wiring (`terraform-modules/modules/aws/vlinder_auth`)

- [ ] New `pre_sign_up` Lambda resource + `lambda_config.pre_sign_up` wiring,
      mirroring the existing `post_confirmation`/`pre_token_generation`
      blocks (IAM role, log group, packaging via the shared
      `data.archive_file.lambda_package`).

- [ ] `terraform-modules/modules/aws/dynamodb` has **no TTL support today**
      (checked `main.tf` — no `ttl` block on `aws_dynamodb_table`, no
      TTL-related variable). Add an optional `ttl_attribute` variable to the
      shared submodule (default `null`, emitting a `ttl { attribute_name =
      var.ttl_attribute, enabled = true }` block only when set) before the
      next bullet — this is a cross-cutting change to code every other table
      composing this submodule also uses, not part of `vlinder_auth` itself.

- [ ] New DynamoDB table `verification_codes`, composed via the same
      `aws/dynamodb` submodule already used for `module.user_role_assignments`
      (now with `ttl_attribute = "expiresAt"` from the bullet above). Key:
      `email` (partition) + `purpose` (sort).

- [ ] `auth_api`'s IAM policy: remove `cognito-idp:ConfirmSignUp`,
      `ResendConfirmationCode`, `ForgotPassword`, `ConfirmForgotPassword`
      (no longer called); add `cognito-idp:AdminSetUserPassword`,
      `cognito-idp:AdminGetUser`, `ses:SendEmail` (scoped to the SES identity
      ARN); add `dynamodb:GetItem`, `PutItem`, `UpdateItem`, `DeleteItem` on
      `module.verification_codes.table_arn`; and — easy to miss, and this
      exact module has been bitten by it before (`auth_api` currently touches
      no DynamoDB at all, per the comment on its existing KMS statement) —
      add `kms:Decrypt`, `kms:GenerateDataKey`, `kms:DescribeKey` on
      `module.verification_codes.kms_key_arn`, mirroring the identical
      statement on `pre_token_generation`'s policy.

- [ ] New variables: `verification_code_ttl_seconds` (default 600),
      `verification_code_max_attempts` (default 5).

- [ ] `ses_configuration` becomes load-bearing (SES has no zero-config
      fallback the way `COGNITO_DEFAULT` was) — add a `precondition`
      requiring it non-null whenever `local.create_public_auth_api` is true,
      so misconfiguration fails at `plan` time.

- [ ] Leave `verification_message_template`/Cognito's own `email_configuration`
      block alone — still backs the separate, currently-unused
      `attributes_require_verification_before_update` (email-change
      re-verification) flow.

- [ ] Verify: `terraform validate` / `plan` against
      `terraform-modules/tests/aws/vlinder_auth` (once Step 7 wires
      `ses_configuration` in there).

### Step 7 — Deployment prerequisites (ops, not a code session — owned by the user)

- [ ] Wire `ses_configuration` into `infra/demo/vlinder_auth`,
      `terraform-modules/tests/aws/vlinder_auth`, and
      `terraform-modules/examples/aws/vlinder_auth` by composing the existing
      `terraform-modules/modules/aws/mail` module (already produces
      `identity_arn`/`configuration_set_name`) for each environment's domain.

- [ ] Request SES production access (out of sandbox) for the ephemeral e2e
      test account/region specifically — it sends to freshly-generated
      `@example.com` addresses per scenario, which sandbox mode would reject.
      This is an AWS Support request; Terraform can't do it.

### Step 8 — TDD: `packages/ui-auth` (AuthChrome + profiles)

- [ ] Write tests first, colocated, matching `SignInFlow.test.tsx`'s style:
      `profiles.test.ts` (`resolveProfile` for both builtins + a passthrough
      custom object; `builtinProfiles` has exactly those two keys) and
      `AuthChrome.test.tsx` (renders `children`/`banner`/`footer`; vlinder
      profile shows "Vlinder Software" + tagline + an `<img>` logo; `default`
      profile shows "Your Company Name" + tagline + the circle placeholder;
      a custom inline `AuthProfile` is respected; `themeFromProfile()`
      includes `logoUrl` only for `logo.kind === 'image'`).

- [ ] Copy `AuthChrome.tsx`/`profiles.ts` from `design_handoff_auth_chrome/`
      (checked into repo root for this handoff — see that directory's
      `README.md`) into `packages/ui-auth/src/`, adjusting only if a test
      reveals a mismatch (none expected — already spot-checked against the
      real `theme.ts`).

- [ ] Export both from `packages/ui-auth/src/index.ts` per the handoff's
      README step 2.

- [ ] Once this step and Step 9 both land, delete `design_handoff_auth_chrome/`
      from the repo root — it's a temporary staging copy, not meant to live
      here long-term. Also revert the markdownlint exclusion added for it in
      `.github/workflows/ci_lint_markdown.yml` and remove its entry from
      `.sastignore` (both added solely to keep CI green against this vendored
      bundle's own `.dc.html` mockups and README formatting).

- [ ] Verify: `npm run test --workspace=packages/ui-auth`.

### Step 9 — Integration: `packages/auth-site`

- [ ] Rewrite `main.tsx`'s four page branches (`signin`/`signup`/`forgot`/
      `verify`) to wrap each form in `<AuthChrome profile={vlinderProfile}
      banner={...} footer={...}>`, passing `theme={themeFromProfile(profile)}`
      to the wrapped form(s). Preserve all existing handlers unchanged.

- [ ] Logo asset: fetch `assets/logo-transparent.svg` from the private
      `VlinderSoftware/design-system` repo (confirmed as the correct
      transparent/light variant via `guidelines/brand-logo.html`, staged
      against a dark background there, matching `AuthChrome`'s colored brand
      panel). Write to
      `packages/auth-site/public/assets/vlinder-logo-transparent.svg` (no
      `public/` dir exists yet — Vite serves it at the site root once
      created).

- [ ] Leave `theme.ts`'s unrelated `defaultVlinderTheme.logoUrl` (pointing at
      a separately-missing `/assets/vlinder-logo.svg`) alone.

- [ ] This rewrite clears 4 pre-existing SonarQube findings in `main.tsx`:
      `role="status"` should be an `<output>` element (`typescript:S6819`,
      line 182) and three buttons missing an explicit `type` attribute
      (`typescript:S9011`, lines 187/188/195). Carry the fixes through into
      whatever replaces those lines (the `banner`/`footer` content moving
      into `AuthChrome`) rather than leaving them behind.

### Step 10 — BDD: `e2e/`

- [ ] `e2e/support/world.ts`: add `getVerificationCode(email, purpose)` — a
      `GetCommand` against the new table (both partition and sort key are
      known here, unlike `getRoleAssignments`'s `QueryCommand`, which only
      has the partition key and expects multiple rows back).

- [ ] Update the `"the account is confirmed"` step (`common.steps.ts`/
      `signup.steps.ts`) — it currently admin-bypasses via
      `AdminConfirmSignUpCommand`, which starts failing once `PreSignUp`
      auto-confirms every account. Replace with: read the real code via
      `getVerificationCode(email, 'signup')`, submit it through the real
      `ConfirmSignUpForm` UI. Replace `signup.feature`'s now-inaccurate
      `Note:` block (Cognito no longer generates this code at all) with one
      explaining the table-read precedent.

- [ ] Brand-panel regression: a new reusable step (e.g. `Then the {string}
      brand panel is visible`) asserting company-name + tagline text,
      appended to `signin.feature` and `signup.feature`.

- [ ] New `e2e/features/forgot-password.feature` + steps: real happy path
      (request code → read it from the table → submit on the confirm step →
      new password signs in successfully) plus a wrong-code negative case.

- [ ] New `e2e/features/verify-email.feature` + steps: real happy path (sign
      up → read the code → submit via `ConfirmSignUpForm` → login gate
      lifts) plus wrong-code and resend-shows-status secondary cases.

- [ ] No change needed to `createConfirmedTestUser`/`session.feature`/
      `admin-panel.feature` — `PreSignUp`'s auto-confirm fields are ignored
      when the trigger fires from `AdminCreateUser` (confirmed via AWS docs).

- [ ] Verify: `cd e2e && npm test` (`cucumber-js --dry-run`) for step
      resolution; real `test:live` run requires Step 6+7 deployed first.

### Step 11 — Final full-suite verification

- [ ] `npm run test --workspaces --if-present` from repo root.
- [ ] `cd e2e && npm test` (dry-run).
- [ ] Once deployed: real `test:live` run.
- [ ] Open `design_handoff_auth_chrome/reference/Auth Workflow.dc.html` /
      `design_handoff_auth_chrome/reference/AuthBrandPanel.dc.html` in a
      browser to eyeball `AuthChrome`'s visual fidelity — do this before
      deleting that directory in Step 8/9.
- [ ] **Exit criterion: clean SAST.** `gh pr checks` shows the SonarQube scan
      passing with zero new findings *and* zero remaining baseline findings —
      Step 1 plus the reminders folded into Steps 4/5/9 above should have
      cleared all 30 of the findings present at this plan's merge-base. If
      any baseline finding is still open when this step runs, it isn't done;
      fix it here rather than shipping the plan with a dirty baseline.

## Progress Log

- 2026-08-23: Step 0 — plan doc drafted and opened for review.
- 2026-08-23: Post-review fixes — added missing `package.json` dependency
  bullets, an `esbuild.config.mjs` entry-point bullet, a shared-submodule
  TTL-support bullet and an explicit KMS-grant bullet, corrected the
  `getVerificationCode` "mirrors `getRoleAssignments`" claim, and checked
  `design_handoff_auth_chrome/` into the repo root (from `Auth workflow
  redesign.zip`) so the AuthChrome steps have something real to point at —
  to be deleted once those steps land. (Step numbers in this entry were
  current at the time; see the next entry — they've since shifted by one.)
- 2026-08-24: Added Step 1 (front-load fixing the 14 pre-existing SonarQube
  findings that no other step would otherwise touch), reminder notes in the
  steps that rewrite `handler.ts`/`esbuild.config.mjs`/`main.tsx` about the
  16 findings their rewrites clear incidentally, and a "clean SAST" exit
  criterion on the final step. All subsequent steps shifted up by one
  number (old Step 1 → 2, ... old Step 10 → 11).
- 2026-08-24: Step 1 — fixed all 14 findings: `crypto.randomUUID()` in place
  of `Math.random()` in the two e2e test-email builders; `aria-label` on the
  admin search input; top-level `await` in `admin-main.ts`; `type="button"`,
  `<output>`, and `Readonly<...>` in `VerifyEmailNotice.tsx`; `Readonly<...>`
  on the other five form components' props; `node:path` in both
  `auth-site` Vite configs. Full test suite (`npm run test --workspaces`,
  `e2e` dry-run), `npm run lint`, and `tsc --noEmit`/`tsc -b` across
  `ui-auth`, `auth-site`, and `e2e` all pass. Opened as PR #70; CI confirms
  the SonarQube scan dropped from 30 baseline findings to 16, with 0 new —
  exactly the 14 targeted here. Merged.
- 2026-08-24: Step 2 — added `shared/secrets.ts`'s `getSecret()` (module-level
  cache, mirrors `cognito-client.ts`'s singleton-client pattern so
  `aws-sdk-client-mock` needs no DI to test it) with TDD-first
  `secrets.test.ts` (fetch, cache-hit skips a second SDK call, error
  propagation, missing-`SecretString` guard). `auth-api/handler.ts` now
  resolves `signingKey` via `getSecret(requireEnv('SESSION_SIGNING_KEY_SECRET_ID'))`;
  `handler.test.ts` mocks `SecretsManagerClient` instead of setting
  `SESSION_SIGNING_KEY` directly. No other file in the repo referenced the
  old env var. Full test suite, lint, and `tsc --noEmit` all pass.
