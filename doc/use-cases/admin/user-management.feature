Feature: Admin — manage users
  As an admin
  I want to view and enable/disable users from the admin panel
  So that I can control access without touching AWS directly

  # First-version scope. The admin panel is served at "/admin" from the same SPA
  # build and rides the same session as the public site; reaching it without a
  # session redirects to sign-in. It calls the bundled admin API
  # (/api/v1/users...), which enforces the caller's privileges per request.
  # Listing is tenant-scoped: a tenant admin (a "...:own" privilege) sees only
  # their own tenant's users; a super-admin (a "...:*" privilege) sees every
  # tenant. See doc/architecture.md.

  Background:
    Given I am signed in as an admin
    And a user exists in my tenant to manage

  Scenario: The admin panel lists the users I can manage
    When the admin panel loads the user list
    Then I see the managed user in the user table
    And each listed user shows their roles

  Scenario: Viewing a single user's details
    When I open the managed user's details
    Then I see the user's email, status, and assigned roles

  Scenario: Disabling a user blocks their access
    When I disable the managed user
    Then the managed user is disabled in the directory
    And the managed user can no longer sign in

  Scenario: Re-enabling a user restores their access
    Given the managed user is disabled
    When I enable the managed user
    Then the managed user is enabled in the directory

  Scenario: A stale assignment does not break the listing
    Given a role assignment exists for a user who is no longer in the directory
    When the admin panel loads the user list
    Then that stale user is skipped
    And the rest of the user list still loads
