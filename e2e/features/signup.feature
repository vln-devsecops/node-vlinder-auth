Feature: Sign up
  As a new user
  I want to create an account through the auth site's real signup form
  So that, once confirmed, I have a working account with the default role

  Note: The pre-sign-up trigger auto-confirms every account in Cognito
  instantly; what actually gates sign-in is this app's own signup code,
  generated, stored, and emailed by auth-api itself (Cognito never sees it).
  e2e has no email-receiving service, so this scenario reads the pending
  code straight out of the verification_codes table -- the same
  "test setup reaches past the app layer" precedent used elsewhere in this
  suite -- and submits it through the real ConfirmSignUpForm UI.

  Scenario: Signing up and confirming assigns the default role
    Given I visit the auth site
    And the "Your Company Name" brand panel is visible
    When I sign up with a new email and password
    Then I see the verify-email notice
    When the account is confirmed
    Then the account has the default role assigned
