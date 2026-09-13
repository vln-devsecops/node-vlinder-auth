# `@vln-devsecops/reference-bff`

A reference Backend-For-Frontend for any adopter of `auth.<zone>`. Run this
(or fork it) alongside your own app so its front-end never talks to the auth
service directly. It implements the "RP back-end (BFF)" participant in
[`doc/vendor-neutral-auth.md`](../../doc/vendor-neutral-auth.md): PKCE
minting, an encrypted `state`, the refresh-token cookie, single-flighted
refresh, double-submit CSRF, and the `/sudo`, `/whoami`, `/logout` relays.

This is the correct, secure way to do this — every adopter starts from (or
forks) this implementation rather than reimplementing the flow from prose.
See `doc/rationale.md`'s "We ship a reference BFF, not just a specification".

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `AUTH_SERVICE_BASE_URL` | yes | Base URL of `auth.<zone>`, e.g. `https://auth.example.com`. |
| `RP_CLIENT_ID` | yes | This app's OAuth `client_id`, registered with the auth service. |
| `RP_REDIRECT_URI` | yes | This app's own `/login/callback` URL, registered in the client's redirect_uri allowlist. |
| `STATE_JWE_KEY` | yes | Exactly 32 bytes (UTF-8), used to encrypt the PKCE `state` (dir/A256GCM). Independent of and never shared with the auth service's own keys. |
| `CSRF_SECRET` | yes | HMAC secret for minting/verifying the double-submit CSRF cookie. |
| `ACCESS_TOKEN_DELIVERY` | no (`cookie`) | `cookie` (default, safer) or `body`. See `doc/rationale.md`'s "Token delivery". |
| `REFRESH_COOKIE_MAX_AGE_SECONDS` | no (`2592000`, 30 days) | Should match the auth service's own `REFRESH_TOKEN_TTL_SECONDS`; change both together. |
| `PORT` | no (`3000`) | Port for the standalone `server.ts` entrypoint. |

## Running standalone

```sh
npm run build
AUTH_SERVICE_BASE_URL=https://auth.example.com \
RP_CLIENT_ID=... \
RP_REDIRECT_URI=https://app.example.com/login/callback \
STATE_JWE_KEY=$(openssl rand -base64 24 | head -c 32) \
CSRF_SECRET=$(openssl rand -hex 32) \
npm start
```

This exposes `GET /login`, `GET /login/callback`, `POST /refresh`,
`GET /whoami`, `POST /sudo`, and `POST /logout`. Put it behind the same
origin as your front-end (or a reverse proxy that makes it appear so), since
its cookies are same-origin, `SameSite=Strict`.

## Mounting into an existing Express app

Prefer this if you already run an Express server and just want to add these
routes to it:

```ts
import { createApp, loadConfig } from '@vln-devsecops/reference-bff'

const bff = createApp(loadConfig())
app.use(bff) // or mount at a sub-path: app.use('/auth', bff)
```

Individual route factories (`loginRoute`, `callbackRoute`, `refreshRoute`,
`relayRoute`) are also exported for adopters who want finer-grained control
over where each route is mounted or how it composes with their own
middleware.

## The client helper

`@vln-devsecops/reference-bff/client` is a separate, browser-safe entry
point — it has no Express or Node-only dependency, so front-end bundlers can
import it directly. It provides a single-flighting refresh helper: several
concurrent `refresh()` calls before the first resolves share one in-flight
request, which is required (not optional) because refresh tokens rotate —
see `doc/vendor-neutral-auth.md`'s Refresh section.

```ts
import { createRefreshClient } from '@vln-devsecops/reference-bff/client'

const refreshClient = createRefreshClient({ refreshUrl: '/refresh' })

// In a fetch/axios 401 interceptor:
const { idToken, accessToken, expiresAt } = await refreshClient.refresh()
```

It reads the `vln_auth_csrf` cookie itself and sends it in the
`X-Vln-Csrf-Token` header automatically; no manual CSRF wiring needed for
calls made through it.
