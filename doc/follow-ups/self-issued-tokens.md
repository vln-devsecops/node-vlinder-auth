# Follow-up: self-issued tokens (portable issuer/JWKS)

**Status:** deferred; tracked in [`../plan.md`](../plan.md)'s backlog.
Captured here so the decision and its reasoning aren't lost — see
[`../rationale.md`](../rationale.md) ("Tokens are Cognito's real tokens, not
re-minted by us") for what the current phase does instead.

## The gap this closes

The implementation currently uses Cognito to build its tokens, so some of the
shape of the generated tokens is dictated by Cognito's implementation. Except
for Cognito's `iss` claim and JWKS, which are fixed to
`https://cognito-idp.<region>.amazonaws.com/<userPoolId>`, this has not been a
true limitation, and we can live with `iss` pointing at Cognito provided the
client side can be told that is where it should expect it to be pointed.
Therefore the current design passes Cognito's real, unmodified access token
through to RP front-ends, and publishes a discovery document at
`auth.<zone>/.well-known/openid-configuration` naming Cognito's issuer and its
real `jwks_uri`. Nothing is mirrored or rewritten: the *address* is ours and
stable, the *values* inside it are what change.

That configuration endpoint is what makes this deferrable at all. No consumer
ever hardcodes an issuer, so switching engines later is a change to one
published value rather than a coordinated redeploy of every relying party —
see [`../rationale.md`](../rationale.md) ("The expected issuer is
configuration, not a constant").

As soon as we run into a limitation that, for whatever reason, we can't live
with, that will disqualify Cognito as the token-minting implementation. This
could be anything. For example, if Cognito sticks to classic crypto for longer
than we can accept, we may need to mint our own tokens to implement a
post-quantum hybrid. If there is something we need to change in the shape of
the tokens we mint that Cognito does not allow, that would also disqualify
Cognito. As long as that doesn't happen, however, Cognito will remain the
engine behind token minting.

**Explicitly not about secrecy.** The decision that motivated deferring this
was clear: Cognito being the engine behind `auth.<zone>` is not a secret and
doesn't need to be hidden from RP backends. Nor is it about *portability* —
the discovery document already buys that. It is about issuer **ownership**:
being able to change what signs a token at all, rather than only being able
to change which Cognito pool does.

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
3. The discovery document's `issuer` and `jwks_uri` change to `auth.<zone>`'s
   own. That is the whole migration as far as any relying party is concerned:
   two published values change, nothing is redeployed.
4. `auth.<zone>` starts serving its own `/.well-known/jwks.json`. At that
   point the discovery document also becomes spec-compliant — its `issuer`
   finally matches the host serving it — so strict OIDC client libraries can
   discover against `auth.<zone>` directly, which they cannot today (see
   "Known deviation" in [`../vendor-neutral-auth.md`](../vendor-neutral-auth.md)).
5. The claims shape is fully ours to define: carry through whatever Cognito
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

- We don't need it: Cognito-shaped tokens are fine and secure and standing up
  the infrastructure and code to implement this now would be a waste of time,
  and will be as long as the need isn't there.
- It requires new signing-key infrastructure (a KMS asymmetric key for the
  auth Lambda to hold, beyond the one already used for the identify-session
  JWS) and a new public endpoint (`/.well-known/jwks.json`) that doesn't exist
  yet.
- Nothing currently consumes it — there's no RP integrated against this
  system yet that would be broken by the simpler pass-through approach. This
  follows the same reasoning `doc/admin-api-csrf.md` (in `terraform-modules`)
  already applies elsewhere in this project: don't build speculative
  security/infra machinery with no caller exercising it.
- The pass-through approach the current phase uses is materially simpler, and
  with the discovery document in place it meets every requirement we actually
  have. What it does not give us is control over *what signs the token* —
  which only matters once one of the triggers below fires.

## When to pick this up

When any one of these becomes real, not before:

- The shape of the generated token can no longer meet our requirements while
  it is built by Cognito, either because of a newly-discovered requirement or
  a change in Cognito's behavior.
- Cryptographic requirements require us to sign tokens differently than what
  Cognito implements, disqualifying Cognito as the backing implementation.
- Two identity engines need to sit behind `auth.<zone>` **at the same time**
  (a different backing store for a different tenant tier, say). A sequential
  migration off Cognito is already handled — that is one published `issuer`
  value changing. What the discovery document cannot express is two live
  issuers at once, since it names exactly one. Self-issuance collapses that
  back to one issuer no matter how many engines sit behind it.
- An external (non-first-party) RP needs to integrate against this system
  and shouldn't be handed AWS-specific issuer/JWKS details as part of doing
  so.
