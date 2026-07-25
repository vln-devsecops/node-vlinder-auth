Feature: End user — sign in
  As a user with a confirmed account
  I want to sign in with my identifier and password
  So that I can reach the application behind the auth site

  # First-version scope. Sign-in is identifier-first: the user first enters an
  # identifier (email or username), the backend resolves how that identifier
  # authenticates, and — in v1 — every identifier resolves to a local password
  # step. Federated / redirect-to-IdP resolution exists in the flow's shape but
  # is not wired up yet. The browser never speaks to Cognito directly; it
  # exchanges only first-party JSON with /api/v1/auth. See
  # doc/vendor-neutral-auth.md.

  Background:
    Given a confirmed account exists for me
    And I am on the auth site's sign-in screen

  Scenario: Signing in with valid credentials
    When I enter my identifier and continue
    And I enter my correct password and sign in
    Then I am signed in
    And I am taken to the application

  Scenario: A wrong password is rejected without revealing why
    When I enter my identifier and continue
    And I enter an incorrect password and sign in
    Then I see a generic "incorrect username or password" error
    And I remain on the sign-in screen

  Scenario: An unknown account is rejected identically to a wrong password
    Given no account exists for the identifier I use
    When I enter that identifier and continue
    And I enter any password and sign in
    Then I see the same generic "incorrect username or password" error
    And the response does not reveal whether the account exists

  Scenario: Switching to a different account returns to the identifier step
    When I enter my identifier and continue
    And I choose "use a different account"
    Then I am returned to the identifier step
    And any password I had typed is cleared
