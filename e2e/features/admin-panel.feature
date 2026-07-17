Feature: Admin panel
  As an admin
  I want to manage users from the admin panel
  So that I can control access without touching AWS directly

  Background:
    # The managed user must exist before the admin signs in: the admin panel
    # fetches the user list once, at page load, so a user created afterwards
    # only appears if creation happens to beat that fetch -- a race the
    # original order lost whenever the admin-api Lambda was already warm.
    Given a user exists to manage
    And I am signed in as an admin

  Scenario: The admin panel lists the managed user
    Then I see the managed user in the user table

  Scenario: Disabling a user updates their status
    When I disable the managed user from the admin panel
    Then the managed user is disabled in Cognito

  Scenario: Granting a user an additional role keeps their existing ones
    When I grant the managed user the "admin" role
    Then the managed user holds the "admin" role
    And the managed user still holds the "member" role

  Scenario: Removing a role leaves the user's other roles intact
    When I grant the managed user the "admin" role
    And I remove the "member" role from the managed user
    Then the managed user no longer holds the "member" role
    And the managed user holds the "admin" role
