Feature: Admin — manage a user's roles
  As an admin
  I want to grant and revoke roles on a user
  So that I can adjust what a user is entitled to do

  # First-version scope. A user may hold several roles within their (single, v1)
  # tenant; granting adds a role rather than replacing the set, and revoking
  # removes one role while leaving the others intact. Role and privilege are
  # kept separate: only a role's resolved privileges ever reach a token, never
  # the role name.
  #
  # A newly granted role defaults to "elevated" activation: it is held for a
  # future sudo step-up and does NOT widen the user's everyday login privileges.
  # Granting it as a login-active role uses "default" activation. The elevation
  # (sudo) flow that would make an elevated role take effect is later work — see
  # doc/vendor-neutral-auth.md — so in v1 an elevated grant is recorded but not
  # yet exercisable.

  Background:
    Given I am signed in as an admin
    And a user in my tenant holds the "member" role

  Scenario: Listing the role catalog
    When I open the list of roles
    Then I see the seeded role catalog
    And each role lists the privileges it grants

  Scenario: Granting an additional role keeps the user's existing roles
    When I grant the user the "admin" role
    Then the user holds the "admin" role
    And the user still holds the "member" role

  Scenario: A newly granted role is held as elevated by default
    When I grant the user the "admin" role
    Then the "admin" role is recorded as an elevated role
    And it does not widen the user's login privileges until a sudo step-up

  Scenario: Granting a role as a login-active role
    When I grant the user the "admin" role as a default login role
    Then the "admin" role is active at the user's next login

  Scenario: Re-granting a role the user already holds is idempotent
    When I grant the user the "member" role again
    Then the user holds the "member" role exactly once

  Scenario: Revoking a role leaves the user's other roles intact
    Given the user also holds the "admin" role
    When I remove the "member" role from the user
    Then the user no longer holds the "member" role
    And the user still holds the "admin" role

  Scenario: Revoking a role the user does not hold is a no-op
    When I remove a role the user does not hold
    Then the user's roles are unchanged

  Scenario: Revoking the user's last role leaves them with no privileges
    Given the user holds only the "member" role
    When I remove the "member" role from the user
    Then the user has no roles
    And the user's next token carries no privileges or tenant claim
