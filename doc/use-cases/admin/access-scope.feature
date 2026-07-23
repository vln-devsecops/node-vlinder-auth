Feature: Admin — tenant access scope is enforced
  As the system owner
  I want every admin action to be checked against the caller's tenant scope
  So that an admin can never act outside the tenants their privileges cover

  # First-version scope. Every admin handler independently re-derives the
  # caller's privileges from their token claims and re-checks access — it does
  # not trust the API's authorizer alone (defense in depth, assertTenantAccess).
  # Scope is encoded in the privilege string itself:
  #   <family>:own  — acts only within the caller's own tenant
  #   <family>:*     — acts across all tenants (super-admin)
  #   <family>       — ungated reference data, no tenant scoping
  # Single-tenant is the v1 default (one implicit tenant); the same mechanism
  # governs multi-tenant deployments. See README.md and doc/architecture.md.

  Scenario: A tenant admin may act within their own tenant
    Given I am an admin whose privileges are scoped to my own tenant
    When I manage a user that belongs to my tenant
    Then the action is allowed

  Scenario: A tenant admin may not act on another tenant's user
    Given I am an admin whose privileges are scoped to my own tenant
    When I try to manage a user that belongs to a different tenant
    Then the action is forbidden

  Scenario: A super-admin may act across all tenants
    Given I am a super-admin whose privileges cover every tenant
    When I manage a user that belongs to any tenant
    Then the action is allowed

  Scenario: Reading the role catalog is ungated by tenant
    Given I am an admin holding the "admin:roles:read" privilege
    When I list the role catalog
    Then the roles are returned regardless of tenant scope

  Scenario: A caller without the required privilege is refused
    Given I am signed in without the privilege an action requires
    When I attempt that action
    Then the action is forbidden
