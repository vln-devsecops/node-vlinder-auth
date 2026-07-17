// esbuild bundle configuration for lambda-src.
//
// Each handler is bundled into a single self-contained CommonJS file at
// dist/<handler>/handler.js — the same paths Terraform's archive_file and
// aws_lambda_function.handler references already expect. Bundling:
//   - eliminates the extensionless-import issue that breaks Node's native
//     ESM loader on Lambda's nodejs22.x runtime (see COPILOT-FIX-02)
//   - inlines dist/shared/* into each bundle so there are no sibling
//     dependencies left in the deployed zip
//   - keeps AWS SDK v3 dependencies bundled in (not external) so deployed
//     versions are controlled by package.json, not Lambda's managed runtime
//
// Format is CommonJS: Node treats .js as CJS unconditionally when a
// package.json with "type": "commonjs" is present in the same directory.
// We write dist/package.json ourselves so the CJS bundles are loaded
// correctly even though the source package has "type": "module".
import * as esbuild from 'esbuild'
import { rmSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Clean dist/ so old tsc output (including unbundled shared/) doesn't linger
// alongside the bundles and cause confusion in the deployed zip.
rmSync(resolve(__dirname, 'dist'), { recursive: true, force: true })

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
}

const handlers = [
  { in: 'src/post-confirmation/handler.ts', out: 'dist/post-confirmation/handler' },
  { in: 'src/pre-token-generation/handler.ts', out: 'dist/pre-token-generation/handler' },
  { in: 'src/admin-api/handler.ts', out: 'dist/admin-api/handler' },
  { in: 'src/auth-api/handler.ts', out: 'dist/auth-api/handler' },
]

for (const { in: entryPoint, out: outfile } of handlers) {
  await esbuild.build({
    ...shared,
    entryPoints: [resolve(__dirname, entryPoint)],
    outfile: resolve(__dirname, `${outfile}.js`),
  })
}

// Write a dist/package.json that marks this directory as CommonJS so Node
// loads the .js bundles as CJS regardless of the source package's
// "type": "module" setting.
writeFileSync(
  resolve(__dirname, 'dist/package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
)
