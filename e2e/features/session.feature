Feature: Session handling
  As a visitor with no active session
  I want to be sent back to the sign-in page if I try to reach the admin
  panel directly
  So that the admin panel never assumes a caller is authenticated

  Scenario: Visiting the admin panel without a session redirects to sign-in
    When I visit the admin panel directly
    Then I am redirected to the sign-in page
