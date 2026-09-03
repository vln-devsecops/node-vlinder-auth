# Follow-up: self-issued tokens (portable issuer/JWKS)

**Status:** deferred; tracked in [`../plan.md`](../plan.md)'s backlog.
Captured here so the decision and its reasoning aren't lost — see
[`../rationale.md`](../rationale.md) ("Tokens are Cognito's real tokens, not
re-minted by us") for what the current phase does instead.

## The gap this closes

Cognito's `iss` claim and JWKS are fixed to
`https://cognito-idp.<region>.amazonaws.com/<userPoolId>` — this is not
configurable, even with a Cognito custom domain (custom domains only rehost
the hosted-UI/OAuth endpoints, never the token issuer or
`/.well-known/jwks.json`). The current phase passes through Cognito's real,
unmodified access token to RP front-ends and mirrors Cognito's JWKS at
`auth.<zone>/.well-known/jwks.json` for convenience, but the token's actual
`iss` still names Cognito's own AWS hostname. Every RP backend that validates
the token is therefore wired to that specific issuer identity.

That's fine as long as Cognito stays the engine behind `auth.<zone>` forever.
It stops being fine the moment that ever changes (a different IdP, a
self-hosted alternative, a second identity backend for a different tenant
tier, etc.) — every RP that hardcoded or cached Cognito's issuer/JWKS would
need to be updated in lockstep with the swap. That's exactly the coupling the
"no consumer depends on Cognito's shapes" goal was meant to avoid — no client
code does, but at the token-validation layer, every consuming backend is still
wired to Cognito's specific issuer.

**Explicitly not about secrecy.** The decision that motivated deferring this
was clear: Cognito being the engine behind `auth.<zone>` is not a secret and
doesn't need to be hidden from RP backends. This follow-up is about issuer
*portability* (can we swap the engine later without every RP's config
changing), not about concealment.

## The proposed shape

`auth.<zone>`'s own auth Lambda becomes the actual token-signing party,
instead of relaying Cognito's token as-is:

1. The auth Lambda still authenticates the user against Cognito exactly as
   today (password verification, MFA, the sign-up/reset state machines — all
   the reasons Cognito is worth keeping, per "What Cognito still buys us
   under own UI" above in the main doc).
2. Once Cognito's own token/response confirms the user, the auth Lambda mints
   its **own** JWT: `iss: https://auth.<zone>`, signed with a key *we* hold
   (this repo already has precedent for exactly this — the identify-session
   JWS is signed with a KMS asymmetric key held by the auth Lambda; the same
   pattern extends naturally here) rather than Cognito's own signing key.
3. `auth.<zone>` serves its own `/.well-known/jwks.json` and
   `/.well-known/openid-configuration` — a real, self-consistent OIDC
   discovery document, not a mirror of someone else's.
4. The claims shape is fully ours to define: carry through whatever Cognito
   verified (`sub`, `email`) plus the first-party authorization claims this
   system already normalizes regardless of backing store (`permissions`,
   `tenantId` — see `shared/privileges.ts` and the pre-token-generation
   trigger in the main app). An RP backend never needs to know or care that
   Cognito sits behind any of it.

This makes `auth.<zone>` a genuine (if thin) OIDC provider in its own right.
The full-OIDC-provider build rejected in [`../rationale.md`](../rationale.md)
for the *interactive* surface (a hosted `/oauth2/authorize`, consent screens)
is not being reopened here; this is scoped narrowly to token issuance and
signing for the handoff that already exists.

## Why this isn't in the current phase

- It requires new signing-key infrastructure (a KMS asymmetric key for the
  auth Lambda to hold, beyond the one already used for the identify-session
  JWS) and two new public endpoints (`/.well-known/jwks.json`,
  `/.well-known/openid-configuration`) that don't exist yet.
- Nothing currently consumes it — there's no RP integrated against this
  system yet that would be broken by the simpler pass-through approach. This
  follows the same reasoning `doc/admin-api-csrf.md` (in `terraform-modules`)
  already applies elsewhere in this project: don't build speculative
  security/infra machinery with no caller exercising it.
- The pass-through approach the current phase uses is materially simpler and
  already meets every requirement except long-term issuer portability.

## When to pick this up

When either of these becomes real, not before:

- A second identity engine needs to sit behind `auth.<zone>` (a different
  backing store for a different tenant tier, or an actual migration off
  Cognito), and existing RPs need to keep working unchanged through that
  swap.
- An external (non-first-party) RP needs to integrate against this system
  and shouldn't be handed AWS-specific issuer/JWKS details as part of doing
  so.
