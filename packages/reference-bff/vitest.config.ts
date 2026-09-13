import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The client helper (client/**) runs in a browser, not Node -- it needs
    // `document.cookie` and `fetch` as globals. `environmentMatchGlobs` was
    // removed in this vitest version, so client/index.test.ts opts into
    // jsdom itself via a `// @vitest-environment jsdom` docblock instead.
    // Everything else (src/**) is server-side Express code and stays on the
    // faster 'node' default, matching lambda-src's convention.
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'client/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'client/**/*.test.ts'],
    },
  },
})
