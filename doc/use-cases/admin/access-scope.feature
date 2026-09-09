Feature: Admin — every admin action is confined to the caller's tenant scope
  As the system owner
  I want each concrete admin action re-checked against the caller's tenant scope
  So that an admin can never act outside the tenants their privileges cover

  # First-version scope. Every admin handler independently re-derives the
  # caller's privileges from their token claims and re-checks access — it does
  # not trust the API's authorizer alone (defense in depth, assertTenantAccess).
  # Privileges are verb:tenant-id:resource-glob:
  #   write:<tenant-id>:admin/users — acts only within that one tenant
  #   write:*:admin/users            — acts across all tenants (super-admin)
  #   read:admin/roles               — ungated reference data, no tenant scoping
  #
  # The complete v1 admin action set, and the privilege each is gated on:
  #   | Action                    | Route                                 | Privilege                     |
  #   | List users in scope       | GET    /users                         | read:<tenant-id>:admin/users  |
  #   | View a single user        | GET    /users/{userId}                | read:<tenant-id>:admin/users  |
  #   | Enable or disable a user  | PATCH  /users/{userId}/enabled        | write:<tenant-id>:admin/users |
  #   | Grant a role to a user    | PUT    /users/{userId}/roles/{roleId} | write:<tenant-id>:admin/users |
  #   | Revoke a role from a user | DELETE /users/{userId}/roles/{roleId} | write:<tenant-id>:admin/users |
  #   | List the role catalog     | GET    /roles                         | read:admin/roles              |
  # Single-tenant is the v1 default (one implicit tenant); the same mechanism
  # governs multi-tenant deployments. See README.md and doc/architecture.md.

  Scenario Outline: A tenant-scoped admin may <action> within their own tenant
    Given I am an admin scoped to my own tenant
    When I <action> for a user in my own tenant
    Then the action is allowed

    Examples:
      | action                    |
      | view the user list        |
      | view a single user        |
      | enable a user             |
      | disable a user            |
      | grant a role to a user    |
      | revoke a role from a user |

  Scenario Outline: A tenant-scoped admin may not <action> in another tenant
    Given I am an admin scoped to my own tenant
    When I <action> for a user in a different tenant
    Then the action is forbidden

    Examples:
      | action                    |
      | view a single user        |
      | enable a user             |
      | disable a user            |
      | grant a role to a user    |
      | revoke a role from a user |

  # A tenant-scoped listing is not forbidden cross-tenant — it simply returns
  # only the caller's own tenant. That filtering is covered in
  # user-management.feature; here we assert the per-user actions above.

  Scenario Outline: A super-admin may <action> in any tenant
    Given I am a super-admin whose privileges cover every tenant
    When I <action> for a user in any tenant
    Then the action is allowed

    Examples:
      | action                    |
      | view the user list        |
      | view a single user        |
      | enable a user             |
      | disable a user            |
      | grant a role to a user    |
      | revoke a role from a user |

  Scenario: Listing the role catalog is ungated by tenant
    Given I am an admin holding the "read:admin/roles" privilege
    When I list the role catalog
    Then the roles are returned regardless of tenant scope

  Scenario Outline: An admin missing the required privilege is refused "<action>"
    Given I am signed in without the "<privilege>" privilege
    When I try to <action>
    Then the action is forbidden

    Examples:
      | action                    | privilege                     |
      | view the user list        | read:<tenant-id>:admin/users  |
      | view a single user        | read:<tenant-id>:admin/users  |
      | enable or disable a user  | write:<tenant-id>:admin/users |
      | grant a role to a user    | write:<tenant-id>:admin/users |
      | revoke a role from a user | write:<tenant-id>:admin/users |
      | list the role catalog     | read:admin/roles              |
