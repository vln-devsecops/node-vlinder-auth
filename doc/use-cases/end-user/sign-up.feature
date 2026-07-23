Feature: End user — sign up for an account
  As a new user
  I want to create an account with my email and a password
  So that, once my email is verified, I have a working account with the
  default role

  # First-version scope. Signup is local email/password only: the auth site
  # speaks the first-party /api/v1/auth surface and never talks to Cognito
  # directly. Email verification uses a code, not a link (the design creates no
  # Cognito hosted domain, so a link has nowhere to point). Federated
  # "Continue with <provider>" signup is a later increment and is out of scope
  # here. See doc/architecture.md and doc/vendor-neutral-auth.md.

  Background:
    Given I am on the auth site's sign-up screen

  Scenario: Registering with valid details sends a verification code
    When I submit my email, first name, last name, and a matching password
    Then my account is created in a pending, unverified state
    And I am shown a notice that a verification code was emailed to me

  Scenario: Confirming with the emailed code activates the account
    Given I have registered and received a verification code by email
    When I enter the verification code
    Then my account becomes active
    And I am assigned the default role for my tenant

  Scenario: Resending the verification code
    Given I have registered but not yet entered the code
    When I ask to resend the verification email
    Then a new verification code is emailed to me
    And I am told the verification email was resent

  Scenario: The email is required
    When I submit the form without an email
    Then I am told the email is required
    And no account is created

  Scenario: The first name is required
    When I submit the form without a first name
    Then I am told the first name is required
    And no account is created

  Scenario: The last name is required
    When I submit the form without a last name
    Then I am told the last name is required
    And no account is created

  Scenario: The password must meet the minimum length
    When I submit the form with a password shorter than 8 characters
    Then I am told the password must be at least 8 characters
    And no account is created

  Scenario: The password and its confirmation must match
    When I submit the form with a confirmation that differs from the password
    Then I am told the passwords do not match
    And no account is created
