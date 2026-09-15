Feature: Demo site smoke test
  As a maintainer
  I want the persistent demo deployment to require authentication, let the
  seeded admin user in, and route every implemented auth-api endpoint to its
  handler
  So that a route implemented at the Lambda level but never wired into API
  Gateway -- as happened with /authorize, /token and /refresh (see
  doc/plan.md step 8b) -- cannot go undetected again

  # Runs against the live demo (infra/demo/vlinder_auth), pointed there via
  # E2E_BASE_URL + the seeded DEMO_USER_* credentials. Not part of the
  # ephemeral CI integration suite -- see infra/demo/vlinder_auth/README.md.

  Scenario: The seeded demo user signs in and reaches the admin panel
    Given the seeded demo user's credentials are configured
    When the demo user signs in at the demo site
    Then they reach the admin panel

  # A route that exists at the Lambda-handler level but was never wired into
  # API Gateway 404s with API Gateway's own generic body -- indistinguishable
  # at a glance from a route that legitimately doesn't exist. Every route
  # below always rejects a bare, param-less request with its own 4xx (never a
  # 2xx, and per each handler's own code, never a 5xx either), so a 404 here
  # can only mean the routing regressed, never that the request was invalid.
  Scenario Outline: Every RP-handoff and session auth-api route is actually wired, not just implemented
    When I send a deliberately invalid <method> request to "<path>"
    Then the response comes from the auth-api Lambda, not a missing API Gateway route

    Examples:
      | method | path                    |
      | GET    | /api/v1/auth/authorize  |
      | POST   | /api/v1/auth/token      |
      | POST   | /api/v1/auth/refresh    |
      | GET    | /api/v1/auth/whoami     |
