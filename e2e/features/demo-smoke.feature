Feature: Demo site smoke test
  As a maintainer
  I want the persistent demo deployment to require authentication and let the
  seeded admin user in
  So that I can confirm the vendor-neutral auth stack works end to end on a live
  site

  # Runs against the live demo (infra/demo/cognito_auth), pointed there via
  # E2E_BASE_URL + the seeded DEMO_USER_* credentials. Not part of the ephemeral
  # CI integration suite -- see infra/demo/cognito_auth/README.md.
  Scenario: The seeded demo user signs in and reaches the admin panel
    Given the seeded demo user's credentials are configured
    When the demo user signs in at the demo site
    Then they reach the admin panel
