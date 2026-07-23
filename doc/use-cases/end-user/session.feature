Feature: End user — session and protected areas
  As a visitor with no active session
  I want to be sent to sign-in when I try to reach a protected page directly
  So that a protected page never assumes an unauthenticated caller is signed in

  # First-version scope. The single SPA build serves the public auth screens at
  # "/" and the admin panel at "/admin", and a session is shared between them.
  # The admin page never renders its own login form: with no valid session it
  # redirects to "/". Tokens are held in sessionStorage in v1 — a transitional
  # step before the httpOnly-cookie session model in doc/vendor-neutral-auth.md.

  Scenario: Visiting a protected page without a session redirects to sign-in
    Given I have no active session
    When I visit the admin panel directly
    Then I am redirected to the sign-in page
    And the protected page does not render

  Scenario: A signed-in session carries across the site
    Given I have signed in through the auth site
    When I navigate from the public site to the admin panel
    Then my existing session is used
    And I am not asked to sign in again
