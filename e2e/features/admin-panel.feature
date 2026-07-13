Feature: Admin panel
  As an admin
  I want to manage users from the admin panel
  So that I can control access without touching AWS directly

  Background:
    Given I am signed in as an admin
    And a user exists to manage

  Scenario: The admin panel lists the managed user
    Then I see the managed user in the user table

  Scenario: Disabling a user updates their status
    When I disable the managed user from the admin panel
    Then the managed user is disabled in Cognito

  Scenario: Changing a user's role updates their assignment
    When I change the managed user's role to "admin"
    Then the managed user's role assignment is "admin"
