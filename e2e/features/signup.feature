Feature: Sign up
  As a new user
  I want to create an account through the auth site's real signup form
  So that, once confirmed, I have a working account with the default role

  Note: Cognito never exposes verification codes via any API, so this
  scenario confirms the account server-side (admin-confirm-sign-up) rather
  than intercepting a real email. It still exercises the real SignUpForm
  component and the real post-confirmation Lambda trigger.

  Scenario: Signing up and confirming assigns the default role
    Given I visit the auth site
    When I sign up with a new email and password
    Then I see the verify-email notice
    When the account is confirmed
    Then the account has the default role assigned
