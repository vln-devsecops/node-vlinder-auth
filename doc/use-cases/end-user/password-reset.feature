Feature: End user — reset a forgotten password
  As a user who has forgotten my password
  I want to reset it using a code sent to my email
  So that I can regain access to my account

  # First-version scope. A two-step, code-based recovery flow wrapping the
  # first-party /api/v1/auth surface: request a reset code, then confirm the
  # code together with a new password. As with verification, recovery uses a
  # code rather than a link.

  Background:
    Given a confirmed account exists for me
    And I am on the auth site's forgot-password screen

  Scenario: Requesting a reset code
    When I submit my email to request a reset code
    Then a reset code is emailed to me
    And I am moved to the step that asks for the code and a new password

  Scenario: Completing the reset with the code and a new password
    Given I have requested a reset code and received it by email
    When I enter the reset code and a new password of at least 8 characters
    Then my password is changed to the new one
    And I can sign in with the new password

  Scenario: The new password must meet the minimum length
    Given I have requested a reset code and received it by email
    When I enter the reset code and a new password shorter than 8 characters
    Then I am told the password must be at least 8 characters
    And my password is not changed
