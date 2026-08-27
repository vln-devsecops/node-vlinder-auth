Feature: Verify email
  As a newly signed-up user
  I want to confirm my email with the code that was sent to me
  So that I can sign in once my address is verified

  Note: The pre-sign-up trigger auto-confirms every account in Cognito
  instantly -- this app's own signup code (stored in DynamoDB, emailed via
  SES) is what actually gates sign-in. e2e has no email-receiving service,
  so these scenarios read the pending code straight out of the
  verification_codes table, the same precedent used by signup.feature.

  Scenario: Signing in is blocked until the verification code is confirmed
    Given I visit the auth site
    When I sign up with a new email and password
    Then I see the verify-email notice
    When I visit the auth site
    And I sign in with valid credentials
    Then I see a sign-in error
    And I remain on the sign-in page

  Scenario: Confirming the real code lifts the sign-in gate
    Given I visit the auth site
    When I sign up with a new email and password
    Then I see the verify-email notice
    When the account is confirmed
    And I sign in with valid credentials
    Then I am redirected to the admin panel

  Scenario: An incorrect verification code is rejected
    Given I visit the auth site
    When I sign up with a new email and password
    And I submit an incorrect verification code
    Then I see a verification error

  Scenario: Resending the code shows a status message
    Given I visit the auth site
    When I sign up with a new email and password
    And I click resend
    Then I see the resend confirmation status
