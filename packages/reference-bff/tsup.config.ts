import { defineConfig } from 'tsup'

// Dual ESM+CJS build with two independent entry points:
//  - `src/index.ts` -- the server-side export (Express, Node-only).
//  - `client/index.ts` -- the browser-safe client helper. Kept as its own
//    tsup entry (not re-exported from `src/index.ts`) so a front-end
//    bundler resolving "@vln-devsecops/reference-bff/client" never pulls in
//    Express or any Node-only module through a shared barrel file.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'client/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
})
