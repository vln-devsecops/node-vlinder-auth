Feature: Forgot password
  As a user who forgot their password
  I want to reset it using a code emailed to me
  So that I can sign back in with a new password

  Note: Cognito never generates or exposes this code -- auth-api generates,
  stores, and emails it itself via SES. e2e has no email-receiving service,
  so these scenarios read the pending code straight out of the
  verification_codes table, the same precedent used by signup.feature.

  Background:
    Given a confirmed test user exists

  Scenario: Requesting and confirming a reset code signs in with the new password
    When I visit the auth site
    And I request a password reset code
    And I submit the reset code with a new password
    And I sign in with valid credentials
    Then I am redirected to the admin panel

  Scenario: An incorrect reset code is rejected
    When I visit the auth site
    And I request a password reset code
    And I submit an incorrect reset code
    Then I see a password-reset error
