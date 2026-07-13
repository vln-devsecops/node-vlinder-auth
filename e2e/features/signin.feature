Feature: Sign in
  As a user with a confirmed account
  I want to sign in through the auth site
  So that I can reach the admin panel

  Background:
    Given a confirmed test user exists

  Scenario: Valid credentials sign the user in
    When I visit the auth site
    And I sign in with valid credentials
    Then I am redirected to the admin panel
    And the user table is visible

  Scenario: Invalid credentials show an error
    When I visit the auth site
    And I sign in with an incorrect password
    Then I see a sign-in error
    And I remain on the sign-in page
