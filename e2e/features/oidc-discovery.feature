Feature: OIDC discovery document
  As a resource server validating an access token
  I want the published discovery document's issuer to match a live token's
  own issuer
  So that I know it is safe to pin against, not a stale or misconfigured value

  Background:
    Given a confirmed test user exists

  Scenario: The discovery document's issuer matches a live access token's issuer
    When I visit the auth site
    And I sign in with valid credentials
    Then the discovery document's issuer matches my session token's issuer
